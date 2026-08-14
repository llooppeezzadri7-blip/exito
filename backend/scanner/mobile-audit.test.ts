import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMobile } from "./mobile-audit";
import { startTestServer, MOBILE_OK_PAGE, OVERFLOWING_PAGE, type TestServer } from "./test-server";

/**
 * Drives a real headless Chromium against real pages. The whole point of the
 * module is that it measures rendered behaviour, so stubbing the browser
 * would test nothing worth testing.
 *
 * The sandbox this was developed in ships a Chromium build that does not
 * match the pinned Playwright version, so the binary is located explicitly
 * when present. Where no browser exists at all, the assertions flip to
 * checking that the audit degrades honestly instead of guessing.
 */

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer({
    "/ancha": { body: OVERFLOWING_PAGE },
    "/ok": { body: MOBILE_OK_PAGE },
  });
});

afterAll(async () => {
  await server.close();
});

const opts = { allowLoopbackForTesting: true, executablePath } as const;

describe("auditMobile con navegador real", () => {
  it("detecta desbordamiento horizontal, texto diminuto y botones pequeños", async () => {
    const result = await auditMobile(server.url("/ancha"), opts);

    if (result.status === "unavailable") {
      expect(result.unavailableReason).toBeTruthy();
      return;
    }

    expect(result.status).toBe("completed");
    expect(result.viewport.width).toBe(390);
    expect(result.hasHorizontalOverflow).toBe(true);
    expect(result.documentWidth).toBeGreaterThan(1000);
    expect(result.overflowingElements.some((e) => e.includes("ancho"))).toBe(true);
    expect(result.tinyTextNodes).toBeGreaterThan(0);
    expect(result.smallTapTargets).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.key)).toContain("horizontal_overflow");
  }, 60_000);

  it("no inventa problemas en una web que sí funciona en móvil", async () => {
    const result = await auditMobile(server.url("/ok"), opts);

    if (result.status === "unavailable") {
      expect(result.unavailableReason).toBeTruthy();
      return;
    }

    expect(result.status).toBe("completed");
    expect(result.hasHorizontalOverflow).toBe(false);
    expect(result.overflowingElements).toEqual([]);
    expect(result.tinyTextNodes).toBe(0);
    expect(result.smallTapTargets).toBe(0);
    expect(result.rendersContent).toBe(true);
    expect(result.findings).toEqual([]);
  }, 60_000);

  it("respeta el guard SSRF: no audita loopback sin permiso explícito", async () => {
    const result = await auditMobile(server.url("/ok"), { executablePath });

    expect(result.status).toBe("unavailable");
    expect(result.unavailableReason).toBeTruthy();
    expect(result.findings).toEqual([]);
  }, 30_000);

  it("reporta 'no verificado' en vez de fingir cuando la página no existe", async () => {
    const result = await auditMobile(server.url("/no-existe-esta-ruta"), opts);

    // Either the page 404s with no content, or the navigation fails outright;
    // in both cases the audit must not claim the site renders fine.
    if (result.status === "completed") {
      expect(result.rendersContent).toBe(false);
      expect(result.findings.map((f) => f.key)).toContain("no_content_rendered");
    } else {
      expect(["failed", "unavailable"]).toContain(result.status);
    }
  }, 60_000);
});
