import { env, hasWebflow } from "@/lib/config/env";
import { ProviderNotConfiguredError } from "@/lib/integrations/business-sources/types";

export interface WebflowSite {
  id: string;
  displayName: string;
  shortName: string;
}

export interface WebflowPage {
  id: string;
  title: string;
  slug: string;
}

/**
 * App-driven Webflow integration (Data API v2) — separate from the
 * Webflow MCP tools available interactively in this coding session. This
 * service is what the *running application* would call server-side (e.g.
 * from a "Publicar demo en Webflow" action), which needs its own site
 * token — the MCP session's Designer-extension auth doesn't carry over
 * to server code. Inactive until WEBFLOW_API_TOKEN + WEBFLOW_SITE_ID are
 * set (see ENVIRONMENT.md).
 *
 * Endpoints verified against developers.webflow.com (not guessed):
 *   GET  https://api.webflow.com/v2/sites
 *   GET  https://api.webflow.com/v2/sites/{site_id}/pages
 *   POST https://api.webflow.com/v2/sites/{site_id}/publish
 *        body requires at least one of customDomains / publishToWebflowSubdomain
 *   GET  https://api.webflow.com/v2/collections/{collection_id}/items
 * Auth: `Authorization: Bearer <token>`.
 *
 * Only the operations verified above are implemented. Anything else
 * (creating pages, writing CMS items, uploading assets) needs its own
 * doc lookup before implementation — see brief §36: never invent
 * endpoints. The Webflow MCP tools connected in this environment already
 * cover page/CMS editing interactively; this class is for the app's own
 * server-triggered actions (e.g. "publish this generated demo").
 */
export class WebflowService {
  private readonly baseUrl = "https://api.webflow.com/v2";

  get isActive() {
    return hasWebflow;
  }

  private headers(): HeadersInit {
    if (!hasWebflow) {
      throw new ProviderNotConfiguredError("Webflow", ["WEBFLOW_API_TOKEN", "WEBFLOW_SITE_ID"]);
    }
    return {
      Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
    };
  }

  async listSites(): Promise<WebflowSite[]> {
    const res = await fetch(`${this.baseUrl}/sites`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Webflow API error: ${res.status}`);
    const data = await res.json();
    return data.sites ?? [];
  }

  async listPages(siteId: string = env.WEBFLOW_SITE_ID!): Promise<WebflowPage[]> {
    const res = await fetch(`${this.baseUrl}/sites/${siteId}/pages`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Webflow API error: ${res.status}`);
    const data = await res.json();
    return data.pages ?? [];
  }

  /** Publishes the whole site (or one page via pageId) to the Webflow subdomain. Never called without explicit user confirmation — see brief §17. */
  async publish(options: { pageId?: string; publishToWebflowSubdomain?: boolean; customDomains?: string[] } = {}): Promise<void> {
    const siteId = env.WEBFLOW_SITE_ID!;
    const res = await fetch(`${this.baseUrl}/sites/${siteId}/publish`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        publishToWebflowSubdomain: options.publishToWebflowSubdomain ?? true,
        customDomains: options.customDomains,
        pageId: options.pageId,
      }),
    });
    if (!res.ok) throw new Error(`Webflow publish error: ${res.status}`);
  }

  async listCollectionItems(collectionId: string): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/collections/${collectionId}/items`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Webflow API error: ${res.status}`);
    const data = await res.json();
    return data.items ?? [];
  }
}
