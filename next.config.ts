import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    // CSV import uploads files of up to 5 MB through a server action. Other actions stay small.
    serverActions: { bodySizeLimit: "6mb" },
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
    ];
  },
};

export default nextConfig;
