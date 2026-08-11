import dns from "node:dns/promises";
import net from "node:net";

/**
 * Blocks Server-Side Request Forgery when the app fetches a user-supplied
 * website URL (website analyzer, competitor URLs, etc.) — see
 * ARCHITECTURE.md §7 / brief §24. The threat: a business's "website" field
 * points at http://169.254.169.254/... (cloud metadata) or an internal
 * service (http://localhost:6379, http://10.0.0.5/admin) and our scanner
 * fetches it on the attacker's behalf.
 *
 * Defense in depth:
 *   1. Scheme allowlist (http/https only — no file:, gopher:, etc).
 *   2. No embedded credentials in the URL.
 *   3. Resolve the hostname ourselves and reject private/loopback/
 *      link-local/reserved/CGNAT ranges (IPv4 + IPv6) BEFORE fetching —
 *      this also closes the DNS-rebinding gap that checking the URL alone
 *      would miss.
 *   4. Re-validate on every redirect hop (redirects are not auto-followed
 *      by fetch here) instead of trusting the final URL only.
 *   5. Timeout + response size cap, enforced by the caller via fetchSafely.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inIpv4Range(ip: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => inIpv4Range(ip, base, prefix));
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // unique local fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded IPv4 too.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  return net.isIP(ip) === 6 ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

async function assertSafeHost(hostname: string): Promise<void> {
  // Reject literal IP targets that are already private, and resolve
  // hostnames to catch DNS rebinding / internal-only DNS entries.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new UnsafeUrlError(`Target IP ${hostname} is not a public address`);
    }
    return;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new UnsafeUrlError("localhost is not allowed");
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve hostname: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Hostname resolved to no addresses: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeUrlError(`${hostname} resolves to a non-public address (${address})`);
    }
  }
}

export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Credentials in URL are not allowed");
  }

  await assertSafeHost(url.hostname);
  return url;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  headers: Headers;
  body: string;
}

/**
 * Fetches a user-supplied URL with SSRF guards, a hop-by-hop redirect
 * re-validation, a timeout, and a response-size cap. Use this for every
 * fetch of an external, user-controlled URL — never call fetch() directly
 * on a business's website_url.
 */
export async function fetchSafely(
  inputUrl: string,
  init?: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> }
): Promise<SafeFetchResult> {
  let currentUrl = await assertSafeUrl(inputUrl);
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = init?.maxBytes ?? MAX_RESPONSE_BYTES;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "AI-Digital-Agency-OS-Scanner/1.0 (+website audit tool)",
          ...init?.headers,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new UnsafeUrlError("Redirect without Location header");
      if (redirectCount === MAX_REDIRECTS) throw new UnsafeUrlError("Too many redirects");

      const nextUrl = new URL(location, currentUrl);
      currentUrl = await assertSafeUrl(nextUrl.toString()); // re-validate every hop
      continue;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { finalUrl: currentUrl.toString(), status: response.status, headers: response.headers, body: "" };
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new UnsafeUrlError(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    return { finalUrl: currentUrl.toString(), status: response.status, headers: response.headers, body };
  }

  throw new UnsafeUrlError("Too many redirects");
}
