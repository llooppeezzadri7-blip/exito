interface Entry<V> {
  value: V;
  expiresAt: number;
}

/** Tiny in-memory TTL cache with bounded size (oldest-first eviction). */
export class TtlCache<V = unknown> {
  private map = new Map<string, Entry<V>>();
  constructor(private readonly maxEntries = 5000) {}

  get(key: string, now = Date.now()): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V, ttlMs: number, now = Date.now()): void {
    if (this.map.size >= this.maxEntries) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: now + ttlMs });
  }

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const v = await loader();
    this.set(key, v, ttlMs);
    return v;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
