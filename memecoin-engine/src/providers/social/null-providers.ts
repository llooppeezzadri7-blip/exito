import type { Chain } from "../../core/types.js";
import type { NewsProvider } from "../types.js";

/**
 * NewsProvider is part of the abstraction but no free, key-less news API was integrated in v0.1.
 * Registering it as UNCONFIGURED keeps the capability visible in the health dashboard as honest "no data".
 */
export class NullNewsProvider implements NewsProvider {
  readonly id = "news-none";
  readonly capability = "news" as const;
  readonly chains: Chain[] = ["solana"];
  isConfigured(): boolean {
    return false;
  }
  async ping(): Promise<boolean> {
    return false;
  }
  async getHeadlines(): Promise<{ title: string; url: string; publishedAt: string; source: string }[]> {
    return [];
  }
}
