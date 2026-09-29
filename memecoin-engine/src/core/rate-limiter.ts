import { sleep } from "./time.js";

/**
 * Token-bucket limiter: `capacity` requests per `intervalMs` window, refilled continuously.
 * `acquire()` waits (instead of throwing) so provider calls naturally slow down under load.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private waiting = 0;

  constructor(
    private readonly capacity: number,
    private readonly intervalMs: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  private refill(now: number): void {
    const elapsed = now - this.last;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / this.intervalMs) * this.capacity);
    this.last = now;
  }

  tryAcquire(now = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until one token becomes available. */
  waitMs(now = Date.now()): number {
    this.refill(now);
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.capacity) * this.intervalMs);
  }

  async acquire(maxWaitMs = 120_000): Promise<void> {
    const start = Date.now();
    this.waiting++;
    try {
      while (!this.tryAcquire()) {
        const w = this.waitMs();
        if (Date.now() - start + w > maxWaitMs) throw new Error("rate limiter wait exceeded");
        await sleep(Math.max(5, w));
      }
    } finally {
      this.waiting--;
    }
  }

  get pending(): number {
    return this.waiting;
  }
}
