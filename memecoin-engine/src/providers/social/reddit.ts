import { z } from "zod";
import type { Chain } from "../../core/types.js";
import { dp } from "../../core/types.js";
import type { SocialSnapshot } from "../../core/model.js";
import type { SocialProvider } from "../types.js";
import { httpJson } from "../../core/http.js";
import { TokenBucket } from "../../core/rate-limiter.js";
import { TtlCache } from "../../core/cache.js";

const SRC = "reddit";
const listing = z.object({
  data: z.object({
    children: z.array(z.object({ data: z.object({ author: z.string().optional(), created_utc: z.number().optional(), score: z.number().optional(), num_comments: z.number().optional(), permalink: z.string().optional(), title: z.string().optional(), selftext: z.string().optional() }).passthrough() })),
  }),
});
const about = z.object({ data: z.object({ created_utc: z.number().optional() }).passthrough() });

export interface RedditMention {
  author: string | null;
  postedAt: string;
  engagement: number;
  url: string | null;
  text: string | null;
  authorAgeDays: number | null;
}

/**
 * Reddit public search JSON (no key). Best-effort: Reddit throttles anonymous clients aggressively,
 * so this provider is a weak, MEDIUM/LOW-confidence signal and is cached for 10 minutes.
 * Mentions are matched on `$SYMBOL` or the exact token name to limit false positives.
 */
export class RedditSocialProvider implements SocialProvider {
  readonly id = SRC;
  readonly capability = "social" as const;
  readonly chains: Chain[] = ["solana", "ethereum", "base", "bsc", "avalanche"];
  private bucket = new TokenBucket(20, 60_000);
  private cache = new TtlCache<RedditMention[]>(2000);
  private authorCache = new TtlCache<number | null>(5000);
  public lastMentions: RedditMention[] = [];

  constructor(private readonly enabled = true) {}
  isConfigured(): boolean {
    return this.enabled;
  }
  async ping(): Promise<boolean> {
    await this.bucket.acquire();
    const r = await httpJson<unknown>("https://www.reddit.com/r/solana/new.json?limit=1", { provider: SRC, retries: 0 });
    return listing.safeParse(r).success;
  }

  async searchMentions(symbol: string | null, name: string | null): Promise<RedditMention[]> {
    const q = symbol && symbol.length >= 3 ? `"$${symbol}"` : name && name.length >= 4 ? `"${name}"` : null;
    if (!q) return [];
    const key = `q:${q}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    await this.bucket.acquire();
    const raw = await httpJson<unknown>(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=day&limit=100`, { provider: SRC, retries: 1 });
    const parsed = listing.safeParse(raw);
    if (!parsed.success) return [];
    const mentions: RedditMention[] = parsed.data.data.children.map((c) => ({
      author: c.data.author ?? null,
      postedAt: new Date((c.data.created_utc ?? Date.now() / 1000) * 1000).toISOString(),
      engagement: (c.data.score ?? 0) + (c.data.num_comments ?? 0),
      url: c.data.permalink ? `https://www.reddit.com${c.data.permalink}` : null,
      text: [c.data.title, c.data.selftext].filter(Boolean).join(" ").slice(0, 500) || null,
      authorAgeDays: null,
    }));
    // Author age for a sample (fake-engagement signal): bounded to 8 lookups per token.
    const authors = [...new Set(mentions.map((m) => m.author).filter((a): a is string => !!a && a !== "[deleted]"))].slice(0, 8);
    for (const a of authors) {
      let age = this.authorCache.get(a);
      if (age === undefined) {
        try {
          await this.bucket.acquire();
          const r = about.safeParse(await httpJson<unknown>(`https://www.reddit.com/user/${encodeURIComponent(a)}/about.json`, { provider: SRC, retries: 0 }));
          age = r.success && r.data.data.created_utc ? (Date.now() / 1000 - r.data.data.created_utc) / 86400 : null;
        } catch {
          age = null;
        }
        this.authorCache.set(a, age, 6 * 3_600_000);
      }
      for (const m of mentions) if (m.author === a) m.authorAgeDays = age;
    }
    this.cache.set(key, mentions, 10 * 60_000);
    return mentions;
  }

  async getSocial(_chain: Chain, token: { mint: string; symbol: string | null; name: string | null }): Promise<Partial<SocialSnapshot>> {
    const mentions = await this.searchMentions(token.symbol, token.name);
    this.lastMentions = mentions;
    const observedAt = new Date().toISOString();
    const hourAgo = Date.now() - 3_600_000;
    const m1h = mentions.filter((m) => new Date(m.postedAt).getTime() >= hourAgo).length;
    const authors = new Set(mentions.map((m) => m.author).filter(Boolean));
    const aged = mentions.filter((m) => m.authorAgeDays !== null);
    const newShare = aged.length ? aged.filter((m) => (m.authorAgeDays ?? 999) < 30).length / aged.length : null;
    return {
      mentions1h: dp(m1h, SRC, "LOW", observedAt),
      mentions24h: dp(mentions.length, SRC, "LOW", observedAt),
      uniqueAuthors24h: dp(authors.size, SRC, "LOW", observedAt),
      newAccountShare: newShare === null ? dp<number>(null, SRC) : dp(newShare, SRC, "LOW", observedAt),
      engagement24h: dp(mentions.reduce((a, m) => a + m.engagement, 0), SRC, "LOW", observedAt),
      sources: [SRC],
      observedAt,
    };
  }
}
