import { describe, it, expect } from "vitest";
import { analyzeSecurity } from "../../src/analyzers/security.js";
import { makeSnapshot, makeSecurity, makeReport } from "../fixtures/factory.js";

describe("security analyzer", () => {
  it("flags active mint authority as CRITICAL and cuts the score", () => {
    const r = analyzeSecurity(makeSnapshot({ security: makeSecurity({ mint: true }), securityReport: null }));
    expect(r.flags.map((f) => f.code)).toContain("MINT_AUTHORITY_ACTIVE");
    expect(r.score!).toBeLessThan(60);
    expect(r.confidence).toBe("HIGH");
  });
  it("flags active freeze authority (honeypot-style) as CRITICAL", () => {
    const r = analyzeSecurity(makeSnapshot({ security: makeSecurity({ freeze: true }) }));
    expect(r.flags.find((f) => f.code === "FREEZE_AUTHORITY_ACTIVE")?.severity).toBe("CRITICAL");
  });
  it("scores a clean token high", () => {
    const r = analyzeSecurity(makeSnapshot());
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.flags.filter((f) => f.severity !== "INFO")).toHaveLength(0);
    expect(r.evidence.every((e) => e.kind === "FACT" || e.kind === "INFERENCE")).toBe(true);
  });
  it("returns UNKNOWN when neither chain nor report can verify authorities (never invents safety)", () => {
    const r = analyzeSecurity(makeSnapshot({ security: null, securityReport: null }));
    expect(r.score).toBeNull();
    expect(r.confidence).toBe("UNKNOWN");
    expect(r.flags.map((f) => f.code)).toContain("UNKNOWN_CONFIGURATION");
  });
  it("falls back to the third-party report with LOW confidence when RPC data is missing", () => {
    const r = analyzeSecurity(makeSnapshot({ security: null, securityReport: makeReport() }));
    expect(r.score).not.toBeNull();
    expect(r.confidence).toBe("LOW");
  });
  it("penalizes Token-2022 permanent delegate / transfer hook", () => {
    const r = analyzeSecurity(makeSnapshot({ security: makeSecurity({ program: "spl-token-2022", ext: ["permanentDelegate", "transferHook"], permanentDelegate: true, transferHook: true }) }));
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["SUSPICIOUS_PERMISSIONS", "SUSPICIOUS_PROGRAM"]));
    expect(r.score!).toBeLessThan(40);
  });
  it("lowers confidence on source disagreement but keeps on-chain facts", () => {
    const rep = makeReport();
    rep.mintAuthorityActive = { ...rep.mintAuthorityActive, value: true };
    const r = analyzeSecurity(makeSnapshot({ securityReport: rep }));
    expect(r.confidence).toBe("MEDIUM");
    expect(r.metrics.mint_authority).toBe(0);
  });
});
