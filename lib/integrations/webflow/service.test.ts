import { afterEach, describe, expect, it, vi } from "vitest";
import { WebflowService } from "./service";
import { ProviderNotConfiguredError } from "@/lib/integrations/business-sources/types";

const CONFIG = { token: "wf-token", siteId: "site-123" };

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebflowService (unconfigured)", () => {
  // Blank counts as unset everywhere in this codebase (see lib/config/env.ts),
  // and passing it explicitly keeps the test independent of the ambient env.
  const service = new WebflowService({ token: "", siteId: "" });

  it("reports itself inactive", () => {
    expect(service.isActive).toBe(false);
    expect(service.siteId).toBeNull();
  });

  it("refuses to call the API instead of sending an unauthenticated request", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await expect(service.publish()).rejects.toThrow(ProviderNotConfiguredError);
    await expect(service.listSites()).rejects.toThrow(ProviderNotConfiguredError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("WebflowService.publish", () => {
  it("posts to the configured site with the bearer token and subdomain flag", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await new WebflowService(CONFIG).publish();

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.webflow.com/v2/sites/site-123/publish");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer wf-token");
    expect(JSON.parse(String(init?.body))).toMatchObject({ publishToWebflowSubdomain: true });
  });

  it("forwards a custom domain list when given one", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await new WebflowService(CONFIG).publish({ customDomains: ["dom-1"], publishToWebflowSubdomain: false });

    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toMatchObject({
      customDomains: ["dom-1"],
      publishToWebflowSubdomain: false,
    });
  });

  it("throws on a non-2xx response rather than reporting a silent success", async () => {
    mockFetch(() => jsonResponse({ message: "forbidden" }, 403));
    await expect(new WebflowService(CONFIG).publish()).rejects.toThrow(/403/);
  });
});

describe("WebflowService.getSiteSubdomainUrl", () => {
  it("derives the webflow.io URL from the site's shortName", async () => {
    mockFetch(() => jsonResponse({ sites: [{ id: "site-123", displayName: "Demo", shortName: "mi-demo" }] }));
    await expect(new WebflowService(CONFIG).getSiteSubdomainUrl()).resolves.toBe("https://mi-demo.webflow.io");
  });

  it("returns null when the configured site isn't in the token's account", async () => {
    mockFetch(() => jsonResponse({ sites: [{ id: "other-site", displayName: "Otro", shortName: "otro" }] }));
    await expect(new WebflowService(CONFIG).getSiteSubdomainUrl()).resolves.toBeNull();
  });

  it("returns null when the site has no shortName", async () => {
    mockFetch(() => jsonResponse({ sites: [{ id: "site-123", displayName: "Demo", shortName: "" }] }));
    await expect(new WebflowService(CONFIG).getSiteSubdomainUrl()).resolves.toBeNull();
  });
});
