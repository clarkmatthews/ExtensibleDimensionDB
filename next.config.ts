import type { NextConfig } from "next";
import { assistantFormTargets } from "./lib/ai-products";

const dev = process.env.NODE_ENV !== "production";
const policy = (formAction: string) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action ${formAction}`,
  "object-src 'none'",
].join("; ");
const contentSecurityPolicy = policy("'self'");
// The assistant consent form redirects back to ChatGPT, Claude, or Grok after Allow or Cancel.
const consentSecurityPolicy = policy(assistantFormTargets());

const nextConfig: NextConfig = {
  experimental: {
    // The record form uploads file attributes (25 MB per save, lib/files.ts) and CSV import
    // uploads files of up to 5 MB, both through server actions.
    serverActions: { bodySizeLimit: "26mb" },
    // proxy.ts runs on every request, and Next buffers at most this much of a body behind it.
    proxyClientMaxBodySize: "26mb",
  },
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/oauth/metadata/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/api/mcp", destination: "/oauth/metadata/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/oauth/metadata/authorization-server" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Listed after the general rule so its policy replaces the general one on this page.
        source: "/oauth/consent",
        headers: [{ key: "Content-Security-Policy", value: consentSecurityPolicy }],
      },
      {
        // Stored files run no script and load nothing else. Chrome shows a PDF through its built-in
        // viewer only when the document's own object-src allows it.
        source: "/api/files/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; object-src 'self'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }],
      },
    ];
  },
};

export default nextConfig;
