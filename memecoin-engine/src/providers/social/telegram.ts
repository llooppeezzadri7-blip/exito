import type { Chain } from "../../core/types.js";
import { dp } from "../../core/types.js";
import type { SocialSnapshot } from "../../core/model.js";
import type { SocialProvider } from "../types.js";
import { httpJson } from "../../core/http.js";
import { TokenBucket } from "../../core/rate-limiter.js";
import { TtlCache } from "../../core/cache.js";

const SRC = "telegram";

/**
 * Telegram Bot API `getChatMemberCount` for public channels/groups linked from the token's socials.
 * Member counts are easily botted: used as *presence* + growth signal only, never as quality.
 */
export class TelegramSocialProvider implements SocialProvider {
  readonly id = SRC;
  readonly capability = "social" as const;
  readonly chains: Chain[] = ["solana", "ethereum", "base", "bsc", "avalanche"];
  private bucket = new TokenBucket(20, 60_000);
  private cache = new TtlCache<number | null>(2000);

  constructor(private readonly botToken: string | undefined) {}
  isConfigured(): boolean {
    return Boolean(this.botToken);
  }
  async ping(): Promise<boolean> {
    if (!this.botToken) return false;
    await this.bucket.acquire();
    const r = await httpJson<{ ok?: boolean }>(`https://api.telegram.org/bot${this.botToken}/getMe`, { provider: SRC, retries: 0 });
    return r.ok === true;
  }
  async getSocial(_chain: Chain, token: { socials: { type: string; url: string }[] }): Promise<Partial<SocialSnapshot>> {
    const observedAt = new Date().toISOString();
    const tg = token.socials.find((s) => s.type.toLowerCase().includes("telegram") || s.url.includes("t.me/"));
    if (!tg || !this.botToken) return { sources: [], observedAt };
    const handle = handleFromUrl(tg.url);
    if (!handle) return { sources: [], observedAt };
    let count = this.cache.get(handle);
    if (count === undefined) {
      try {
        await this.bucket.acquire();
        const r = await httpJson<{ ok?: boolean; result?: number }>(`https://api.telegram.org/bot${this.botToken}/getChatMemberCount?chat_id=${encodeURIComponent("@" + handle)}`, { provider: SRC, retries: 0 });
        count = r.ok && typeof r.result === "number" ? r.result : null;
      } catch {
        count = null;
      }
      this.cache.set(handle, count, 10 * 60_000);
    }
    return { telegramMembers: count === null ? dp<number>(null, SRC) : dp(count, SRC, "MEDIUM", observedAt), hasTelegram: true, sources: count === null ? [] : [SRC], observedAt };
  }
}

export function handleFromUrl(url: string): string | null {
  const m = url.match(/t\.me\/(?:s\/)?(\+?[A-Za-z0-9_]+)/);
  if (!m || !m[1] || m[1].startsWith("+")) return null; // private invite links cannot be counted
  return m[1];
}
