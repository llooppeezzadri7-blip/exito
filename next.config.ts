import type { NextConfig } from "next";

// Supabase URL is the only external origin the *browser* ever talks to directly
// (server-side integrations — Anthropic, Google, Webflow — aren't subject to CSP).
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";

const isDev = process.env.NODE_ENV === "development";

// No nonces: this app relies on static rendering for most dashboard routes
// (see ROADMAP.md Phase 1), and nonce-based CSP requires forcing every page
// to dynamic rendering. Without a nonce, script-src needs 'unsafe-inline' —
// the App Router injects inline `self.__next_f.push(...)` bootstrap scripts
// to stream RSC flight data on every page, confirmed by inspecting rendered
// HTML output; blocking them breaks hydration. This matches Next.js's own
// "Without Nonces" CSP guide (node_modules/next/dist/docs/.../content-security-policy.md).
// Trade-off: 'unsafe-inline' weakens script-src's XSS protection vs. a
// nonce-based policy — origin restriction (script-src 'self', no wildcard
// hosts) and the other directives (object-src, frame-ancestors, form-action)
// still hold. See SECURITY.md.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
