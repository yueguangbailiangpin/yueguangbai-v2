import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  messages: unknown[] = [];
  constructor(readonly name: string) { FakeBroadcastChannel.instances.push(this); }
  postMessage(message: unknown): void { this.messages.push(message); }
  close(): void {}
}

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();FakeBroadcastChannel.instances=[];});

describe('session invalidation broadcast', () => {
  it('clears a peer tab deterministically from the invalidation message without polling', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const module=await import('./session-invalidation');
    const origin=new QueryClient();const peer=new QueryClient();
    origin.setQueryData(['staff','fixture'],'origin-private');peer.setQueryData(['staff','fixture'],'peer-private');peer.setQueryData(['buyer','fixture'],'peer-customer');
    module.getSessionInvalidationSnapshot(origin,'staff');
    module.getSessionInvalidationSnapshot(peer,'staff');
    await module.invalidateSessionCycle(origin,'staff',module.captureSessionCycle(origin,'staff'),'request-origin-401');
    expect(FakeBroadcastChannel.instances[1]?.messages).toEqual([{type:'SESSION_INVALIDATED',identity:'staff',requestId:'request-origin-401'}]);
    FakeBroadcastChannel.instances[3]?.onmessage?.({data:FakeBroadcastChannel.instances[1]?.messages[0]} as MessageEvent<unknown>);
    await vi.waitFor(()=>expect(module.getSessionInvalidationSnapshot(peer,'staff')).toMatchObject({status:'INVALIDATED',requestId:'request-origin-401'}));
    expect(peer.getQueryData(['staff','fixture'])).toBeUndefined();
    expect(peer.getQueryData(['buyer','fixture'])).toBe('peer-customer');
  });
});
