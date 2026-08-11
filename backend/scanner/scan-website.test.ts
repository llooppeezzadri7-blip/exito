import { describe, expect, it } from "vitest";
import { scanWebsite } from "./scan-website";

describe("scanWebsite (network required — real fetch against example.com)", () => {
  it("scans a real public site and returns structured signals", async () => {
    const result = await scanWebsite("https://example.com/");

    expect(result.status).toBe("completed");
    expect(result.technical.https).toBe(true);
    expect(typeof result.seo.title).toBe("string");
    expect(result.unavailableMetrics).toContain("lighthouse_performance_score");
  });

  it("fails safely for an SSRF-blocked target instead of fetching it", async () => {
    const result = await scanWebsite("http://169.254.169.254/latest/meta-data/");
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });

  it("fails safely for an unreachable host", async () => {
    const result = await scanWebsite("https://this-domain-does-not-exist-ai-agency-os.example/");
    expect(result.status).toBe("failed");
  });
});
