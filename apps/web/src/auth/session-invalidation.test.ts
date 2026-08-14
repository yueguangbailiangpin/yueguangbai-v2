import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  messages: unknown[] = [];
  closed = false;
  constructor(readonly name: string) { FakeBroadcastChannel.instances.push(this); }
  postMessage(message: unknown): void { this.messages.push(message); }
  close(): void { this.closed = true; }
}

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();FakeBroadcastChannel.instances=[];});

describe('session invalidation broadcast', () => {
  it('invalidates only a peer with the same session marker, without a broadcast loop', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const module=await import('./session-invalidation');
    const origin=new QueryClient();const peer=new QueryClient();
    const marker=await module.createSessionInvalidationMarker('staff','staff-1',4,1_700_432_000_000);
    const customerMarker=await module.createSessionInvalidationMarker('buyer','buyer-1',1,1_700_000_000_000);
    module.establishFreshSessionCycle(origin,'staff',module.captureSessionCycle(origin,'staff'),marker);
    module.establishFreshSessionCycle(peer,'staff',module.captureSessionCycle(peer,'staff'),marker);
    module.establishFreshSessionCycle(peer,'buyer',module.captureSessionCycle(peer,'buyer'),customerMarker);
    origin.setQueryData(['staff','fixture'],'origin-private');peer.setQueryData(['staff','fixture'],'peer-private');peer.setQueryData(['buyer','fixture'],'peer-customer');

    await module.invalidateSessionCycle(origin,'staff',module.captureSessionCycle(origin,'staff'),'request-origin-401');
    const message=FakeBroadcastChannel.instances[1]?.messages[0];
    expect(message).toMatchObject({type:'SESSION_INVALIDATED',identity:'staff',requestId:'request-origin-401',marker:expect.stringMatching(/^[0-9a-f]{64}$/u)});
    expect(JSON.stringify(message)).not.toContain('staff-1');
    FakeBroadcastChannel.instances[3]?.onmessage?.({data:message} as MessageEvent<unknown>);

    await vi.waitFor(()=>expect(module.getSessionInvalidationSnapshot(peer,'staff')).toMatchObject({status:'INVALIDATED',requestId:'request-origin-401'}));
    expect(peer.getQueryData(['staff','fixture'])).toBeUndefined();
    expect(peer.getQueryData(['buyer','fixture'])).toBe('peer-customer');
    expect(module.getSessionInvalidationSnapshot(peer,'buyer')).toMatchObject({status:'STABLE',marker:customerMarker});
    expect(FakeBroadcastChannel.instances[3]?.messages).toEqual([]);

    module.disposeSessionInvalidation(origin);module.disposeSessionInvalidation(peer);
    expect(FakeBroadcastChannel.instances).toHaveLength(4);
    expect(FakeBroadcastChannel.instances.every((channel)=>channel.closed&&channel.onmessage===null)).toBe(true);
  });

  it('ignores an old staff invalidation after the receiving tab establishes a new session', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const module=await import('./session-invalidation');
    const origin=new QueryClient();const peer=new QueryClient();
    const oldMarker=await module.createSessionInvalidationMarker('staff','staff-1',4,1_700_432_000_000);
    const newMarker=await module.createSessionInvalidationMarker('staff','staff-2',4,1_700_432_100_000);
    module.establishFreshSessionCycle(origin,'staff',module.captureSessionCycle(origin,'staff'),oldMarker);
    module.establishFreshSessionCycle(peer,'staff',module.captureSessionCycle(peer,'staff'),oldMarker);
    await module.invalidateSessionCycle(origin,'staff',module.captureSessionCycle(origin,'staff'),'request-old-401');
    const oldMessage=FakeBroadcastChannel.instances[1]?.messages[0];
    module.establishFreshSessionCycle(peer,'staff',module.captureSessionCycle(peer,'staff'),newMarker);
    peer.setQueryData(['staff','fixture'],'new-private');
    FakeBroadcastChannel.instances[3]?.onmessage?.({data:oldMessage} as MessageEvent<unknown>);

    await Promise.resolve();
    expect(module.getSessionInvalidationSnapshot(peer,'staff')).toMatchObject({status:'STABLE',marker:newMarker});
    expect(peer.getQueryData(['staff','fixture'])).toBe('new-private');
    module.disposeSessionInvalidation(origin);module.disposeSessionInvalidation(peer);
  });
});
