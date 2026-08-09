export interface StaffMcpRateLimiter {
  take(
    key: string,
    now: number,
    limit: number,
    windowMs: number,
  ): boolean | Promise<boolean>;
}

/** Local-only fixed-window limiter; production activation requires a durable provider. */
export class MemoryStaffMcpRateLimiter implements StaffMcpRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  take(key: string, now: number, limit: number, windowMs: number): boolean {
    const current = this.windows.get(key);
    if (!current || now - current.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}
