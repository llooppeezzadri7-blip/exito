import { describe, expect, it } from "vitest";
import { checkRateLimit, RateLimitError } from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows calls up to the limit", () => {
    const key = `test-${Math.random()}`;
    expect(() => checkRateLimit(key, 3, 60_000)).not.toThrow();
    expect(() => checkRateLimit(key, 3, 60_000)).not.toThrow();
    expect(() => checkRateLimit(key, 3, 60_000)).not.toThrow();
  });

  it("throws once the limit is exceeded within the window", () => {
    const key = `test-${Math.random()}`;
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    expect(() => checkRateLimit(key, 2, 60_000)).toThrow(RateLimitError);
  });

  it("resets after the window elapses", async () => {
    const key = `test-${Math.random()}`;
    checkRateLimit(key, 1, 20);
    expect(() => checkRateLimit(key, 1, 20)).toThrow(RateLimitError);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(() => checkRateLimit(key, 1, 20)).not.toThrow();
  });

  it("tracks independent keys separately", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    checkRateLimit(keyA, 1, 60_000);
    expect(() => checkRateLimit(keyA, 1, 60_000)).toThrow(RateLimitError);
    expect(() => checkRateLimit(keyB, 1, 60_000)).not.toThrow();
  });
});
