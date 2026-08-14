import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP, clearStaffTransport } from './customer-transport-invalidation';

export type SessionInvalidationIdentity = 'buyer' | 'seller' | 'staff';
export type SessionInvalidationStatus = 'STABLE' | 'CLEARING' | 'INVALIDATED' | 'FAILED';
export type SessionInvalidationSnapshot = Readonly<{
  status: SessionInvalidationStatus;
  generation: number;
  requestId: string | null;
  marker: string | null;
}>;
export type SessionCycle = Readonly<{
  generation: number;
  status: SessionInvalidationStatus;
  marker: string | null;
}>;

type ActiveInvalidation = Readonly<{
  generation: number;
  promise: Promise<void>;
}>;
type Channel = {
  snapshot: SessionInvalidationSnapshot;
  listeners: Set<() => void>;
  active: ActiveInvalidation | null;
  broadcast: BroadcastChannel | null;
};
type ClientChannels = Readonly<{ customer: Channel; staff: Channel }>;
type BroadcastMessage = Readonly<{
  type: 'SESSION_INVALIDATED';
  identity: SessionInvalidationIdentity;
  marker: string;
  requestId: string | null;
}>;

const channelsByClient = new WeakMap<QueryClient, ClientChannels>();

function isBroadcastMessage(value: unknown): value is BroadcastMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BroadcastMessage>;
  return candidate.type === 'SESSION_INVALIDATED'
    && (candidate.identity === 'buyer' || candidate.identity === 'seller' || candidate.identity === 'staff')
    && typeof candidate.marker === 'string' && /^[0-9a-f]{64}$/u.test(candidate.marker)
    && (candidate.requestId === null || typeof candidate.requestId === 'string');
}

function createChannel(client: QueryClient, kind: 'customer' | 'staff'): Channel {
  const channel: Channel = {
    snapshot: Object.freeze({ status: 'STABLE', generation: 0, requestId: null, marker: null }),
    listeners: new Set(),
    active: null,
    broadcast: null,
  };
  if (typeof BroadcastChannel !== 'undefined') {
    channel.broadcast = new BroadcastChannel('ygb-session-invalidation-v1');
    channel.broadcast.onmessage = (event: MessageEvent<unknown>) => {
      if (!isBroadcastMessage(event.data)) return;
      if ((kind === 'staff') !== (event.data.identity === 'staff')) return;
      const current = captureSessionCycle(client, event.data.identity);
      if (current.marker !== event.data.marker) return;
      void beginInvalidation(client, event.data.identity, current.generation, event.data.marker, event.data.requestId);
    };
  }
  return channel;
}

function clientChannels(client: QueryClient): ClientChannels {
  const existing = channelsByClient.get(client);
  if (existing) return existing;
  const created = Object.freeze({ customer: createChannel(client, 'customer'), staff: createChannel(client, 'staff') });
  channelsByClient.set(client, created);
  return created;
}

function channelFor(client: QueryClient, identity: SessionInvalidationIdentity): Channel {
  const channels = clientChannels(client);
  return identity === 'staff' ? channels.staff : channels.customer;
}

function publish(channel: Channel, snapshot: SessionInvalidationSnapshot): void {
  channel.snapshot = Object.freeze(snapshot);
  for (const listener of channel.listeners) listener();
}

export function captureSessionCycle(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
): SessionCycle {
  const snapshot = channelFor(client, identity).snapshot;
  return Object.freeze({ generation: snapshot.generation, status: snapshot.status, marker: snapshot.marker });
}

export async function createSessionInvalidationMarker(
  identity: SessionInvalidationIdentity,
  principalId: string,
  sessionVersion: number,
  sessionBoundary: number,
): Promise<string> {
  const input = new TextEncoder().encode(`${identity}\u0000${principalId}\u0000${sessionVersion}\u0000${sessionBoundary}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function establishFreshSessionCycle(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
  requestCycle: SessionCycle,
  marker: string,
): number | null {
  const channel = channelFor(client, identity);
  const current = channel.snapshot;
  const mayEstablish = requestCycle.status === 'STABLE' || requestCycle.status === 'INVALIDATED';
  if (!mayEstablish
    || current.generation !== requestCycle.generation
    || current.status !== requestCycle.status
    || !/^[0-9a-f]{64}$/u.test(marker)) return null;
  const generation = current.generation + 1;
  channel.active = null;
  publish(channel, { status: 'STABLE', generation, requestId: null, marker });
  return generation;
}

export function getSessionInvalidationSnapshot(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
): SessionInvalidationSnapshot {
  return channelFor(client, identity).snapshot;
}

export function subscribeSessionInvalidation(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
  listener: () => void,
): () => void {
  const channel = channelFor(client, identity);
  channel.listeners.add(listener);
  return () => { channel.listeners.delete(listener); };
}

export function useSessionInvalidation(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
): SessionInvalidationSnapshot {
  return useSyncExternalStore(
    (listener) => subscribeSessionInvalidation(client, identity, listener),
    () => getSessionInvalidationSnapshot(client, identity),
    () => getSessionInvalidationSnapshot(client, identity),
  );
}

function beginInvalidation(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
  generation: number,
  marker: string | null,
  requestId: string | null,
): Promise<void> {
  const channel = channelFor(client, identity);
  if (channel.snapshot.generation !== generation || channel.snapshot.marker !== marker) return Promise.resolve();
  if (channel.active?.generation === generation) return channel.active.promise;
  if (channel.snapshot.status === 'INVALIDATED') return Promise.resolve();

  publish(channel, { status: 'CLEARING', generation, requestId, marker });
  const remainsCurrent = (): boolean => channel.snapshot.generation === generation
    && channel.snapshot.status === 'CLEARING' && channel.snapshot.marker === marker;
  const promise = (async () => {
    try {
      if (identity === 'staff') await clearStaffTransport(client, remainsCurrent);
      else await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client, remainsCurrent);
      if (remainsCurrent()) publish(channel, { status: 'INVALIDATED', generation, requestId, marker });
    } catch (error: unknown) {
      if (remainsCurrent()) publish(channel, { status: 'FAILED', generation, requestId, marker });
      throw error;
    }
  })();
  channel.active = Object.freeze({ generation, promise });
  return promise;
}

export function invalidateSessionCycle(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
  requestCycle: SessionCycle,
  requestId: string | null,
): Promise<void> {
  const invalidation = beginInvalidation(client, identity, requestCycle.generation, requestCycle.marker, requestId);
  broadcastSessionInvalidation(client, identity, requestCycle, requestId);
  return invalidation;
}

export function broadcastSessionInvalidation(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
  requestCycle: SessionCycle,
  requestId: string | null,
): void {
  const channel = channelFor(client, identity);
  if (requestCycle.marker === null
    || channel.snapshot.generation !== requestCycle.generation
    || channel.snapshot.marker !== requestCycle.marker) return;
  channel.broadcast?.postMessage({
    type: 'SESSION_INVALIDATED', identity, marker: requestCycle.marker, requestId,
  } satisfies BroadcastMessage);
}

export function retrySessionInvalidation(
  client: QueryClient,
  identity: SessionInvalidationIdentity,
): Promise<void> {
  const channel = channelFor(client, identity);
  if (channel.snapshot.status !== 'FAILED') return Promise.resolve();
  const { generation, marker, requestId } = channel.snapshot;
  channel.active = null;
  return beginInvalidation(client, identity, generation, marker, requestId);
}

export function disposeSessionInvalidation(client: QueryClient): void {
  const channels = channelsByClient.get(client);
  if (!channels) return;
  for (const channel of [channels.customer, channels.staff]) {
    channel.listeners.clear();
    if (channel.broadcast) {
      channel.broadcast.onmessage = null;
      channel.broadcast.close();
      channel.broadcast = null;
    }
  }
  channelsByClient.delete(client);
}

export function SessionInvalidationClientLifecycle({ children }: { children: ReactNode }): ReactNode {
  const client = useQueryClient();
  useEffect(() => () => { disposeSessionInvalidation(client); }, [client]);
  return children;
}
