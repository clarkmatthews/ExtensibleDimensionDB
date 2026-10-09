import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { claimedEmail, decideSso, domainAllowed, openFlow, providerConfig, sealFlow } from "@/lib/sso";

const settings = { allowedDomains: ["example.com"], createUsers: false };
const user = (id: string, oidcSubject: string | null = null, isActive = true) => ({ id, oidcSubject, isActive });

describe("single sign-on decisions", () => {
  it("signs in a person already linked by subject", () => {
    expect(decideSso({ sub: "s1" }, settings, user("u1", "s1"), null)).toEqual({ kind: "signin", userId: "u1" });
  });

  it("links an existing account by verified email on first sign-in", () => {
    expect(decideSso({ sub: "s1", email: "Pat@Example.com", email_verified: true }, settings, null, user("u1"))).toEqual({ kind: "link", userId: "u1" });
  });

  it("refuses an email that is linked to a different identity", () => {
    expect(decideSso({ sub: "s2", email: "pat@example.com" }, settings, null, user("u1", "s1"))).toMatchObject({ reason: "other-identity" });
  });

  it("refuses unverified email, other domains, disabled accounts, and unknown people", () => {
    expect(decideSso({ sub: "s1", email: "pat@example.com", email_verified: false }, settings, null, user("u1"))).toMatchObject({ reason: "no-email" });
    expect(decideSso({ sub: "s1", email: "pat@other.com" }, settings, null, user("u1"))).toMatchObject({ reason: "domain" });
    expect(decideSso({ sub: "s1", email: "pat@example.com" }, settings, null, user("u1", null, false))).toMatchObject({ reason: "disabled" });
    expect(decideSso({ sub: "s1", email: "new@example.com" }, settings, null, null)).toMatchObject({ reason: "no-account" });
  });

  it("creates an account when that is turned on", () => {
    expect(decideSso({ sub: "s1", email: "new@example.com", name: "New Person" }, { ...settings, createUsers: true }, null, null)).toEqual({
      kind: "create",
      email: "new@example.com",
      name: "New Person",
    });
  });

  it("uses the Entra sign-in name when email is missing", () => {
    expect(claimedEmail({ preferred_username: "Pat@Example.com" })).toBe("pat@example.com");
    expect(domainAllowed("pat@example.com", [])).toBe(true);
    expect(domainAllowed("pat@example.com", ["@EXAMPLE.com"])).toBe(true);
  });

  it("seals the per-attempt values and rejects tampering or expiry", () => {
    const sealed = sealFlow({ state: "st", nonce: "no", verifier: "ve" }, 1_000);
    expect(openFlow(sealed, 2_000)).toMatchObject({ state: "st", nonce: "no", verifier: "ve" });
    expect(openFlow(sealed, 1_000 + 11 * 60_000)).toBeNull();
    const [body, signature] = sealed.split(".");
    expect(openFlow(`${body}x.${signature}`, 2_000)).toBeNull();
  });
});

/** A minimal OpenID provider: discovery, keys, and a token endpoint that checks PKCE. */
describe("authorization code flow against a provider", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { challenge: string; nonce: string }>();
  let server: Server;
  let issuer = "";

  function idToken(nonce: string) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ iss: issuer, aud: "client-1", sub: "subject-1", email: "pat@example.com", email_verified: true, nonce, iat: now, exp: now + 300 }),
    ).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
    return `${header}.${payload}.${signature}`;
  }

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", issuer);
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === "/.well-known/openid-configuration") {
        return json(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
      if (url.pathname === "/token") {
        let raw = "";
        request.on("data", (chunk) => (raw += chunk));
        request.on("end", () => {
          const form = new URLSearchParams(raw);
          // RFC 6749 section 2.3.1: the client id and secret are form-encoded before Basic encoding.
          const basic = Buffer.from((request.headers.authorization ?? "").replace(/^Basic /, ""), "base64")
            .toString()
            .split(":")
            .map((part) => decodeURIComponent(part))
            .join(":");
          const pending = codes.get(form.get("code") ?? "");
          const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
          if (basic !== "client-1:secret-1" || !pending || pending.challenge !== challenge) return json(400, { error: "invalid_grant" });
          json(200, { access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken(pending.nonce) });
        });
        return;
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("signs in with PKCE, state, and nonce checked, and rejects a forged state", async () => {
    const { client, config } = await providerConfig({ issuer, clientId: "client-1" }, "secret-1");
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const authorize = client.buildAuthorizationUrl(config, {
      redirect_uri: "https://app.example.com/api/auth/oidc/callback",
      scope: "openid email profile",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");

    // The provider redirects back with a code bound to the challenge and nonce.
    const code = randomUUID();
    codes.set(code, { challenge: authorize.searchParams.get("code_challenge")!, nonce });
    const callback = new URL(`https://app.example.com/api/auth/oidc/callback?code=${code}&state=${state}`);
    const tokens = await client.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    expect(tokens.claims()).toMatchObject({ sub: "subject-1", email: "pat@example.com" });

    const forged = new URL(`https://app.example.com/api/auth/oidc/callback?code=${code}&state=not-the-state`);
    await expect(
      client.authorizationCodeGrant(config, forged, { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce }),
    ).rejects.toThrow();
  });
});
