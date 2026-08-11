import { describe, expect, it } from "vitest";
import { assertSafeUrl, UnsafeUrlError } from "./ssrf-guard";

describe("assertSafeUrl", () => {
  it("rejects unsupported schemes", async () => {
    await expect(assertSafeUrl("ftp://example.com")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects credentials embedded in the URL", async () => {
    await expect(assertSafeUrl("http://user:pass@example.com")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects loopback addresses", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://localhost/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://[::1]/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects the cloud metadata address", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects private/internal ranges", async () => {
    await expect(assertSafeUrl("http://10.0.0.5/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://172.16.5.5/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://[fe80::1]/")).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl("http://[fc00::1]/")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects an IPv4-mapped IPv6 address pointing at a private range", async () => {
    await expect(assertSafeUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow(UnsafeUrlError);
  });

  it("allows a public IPv4 address", async () => {
    await expect(assertSafeUrl("http://8.8.8.8/")).resolves.toBeInstanceOf(URL);
  });

  it("allows a real public hostname (network required)", async () => {
    await expect(assertSafeUrl("https://example.com/")).resolves.toBeInstanceOf(URL);
  });
});
