import type { StaffMcpToolResult } from '@ygb/contracts';

export type StaffMcpReplayAcquire =
  | { kind: 'NEW' }
  | { kind: 'REPLAY'; result: StaffMcpToolResult }
  | { kind: 'CONFLICT' }
  | { kind: 'IN_PROGRESS' };

export interface StaffMcpReplayStore {
  acquire(key: string, requestHash: string): StaffMcpReplayAcquire;
  complete(key: string, requestHash: string, result: StaffMcpToolResult): void;
  fail(key: string, requestHash: string): void;
}

interface Entry {
  requestHash: string;
  status: 'PROCESSING' | 'COMPLETED';
  result?: StaffMcpToolResult;
}

/** Local-only replay boundary; production activation requires a durable provider. */
export class MemoryStaffMcpReplayStore implements StaffMcpReplayStore {
  private readonly entries = new Map<string, Entry>();

  acquire(key: string, requestHash: string): StaffMcpReplayAcquire {
    const current = this.entries.get(key);
    if (!current) {
      this.entries.set(key, { requestHash, status: 'PROCESSING' });
      return { kind: 'NEW' };
    }
    if (current.requestHash !== requestHash) return { kind: 'CONFLICT' };
    if (current.status === 'PROCESSING') return { kind: 'IN_PROGRESS' };
    if (!current.result) throw new Error('invalid_replay_store_state');
    return { kind: 'REPLAY', result: current.result };
  }

  complete(key: string, requestHash: string, result: StaffMcpToolResult): void {
    const current = this.entries.get(key);
    if (!current || current.requestHash !== requestHash
      || current.status !== 'PROCESSING') {
      throw new Error('invalid_replay_completion');
    }
    this.entries.set(key, { requestHash, status: 'COMPLETED', result });
  }

  fail(key: string, requestHash: string): void {
    const current = this.entries.get(key);
    if (current?.requestHash === requestHash && current.status === 'PROCESSING') {
      this.entries.delete(key);
    }
  }
}
