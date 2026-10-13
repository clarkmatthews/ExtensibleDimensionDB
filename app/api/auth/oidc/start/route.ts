import { NextResponse, type NextRequest } from "next/server";
import { decryptSecret } from "@/lib/mail";
import { FLOW_COOKIE, loadSsoSettings, providerConfig, redirectUri, sealFlow, type SsoReason } from "@/lib/sso";

function fail(request: NextRequest, reason: SsoReason) {
  return NextResponse.redirect(new URL(`/login?error=sso&reason=${encodeURIComponent(reason)}`, request.url));
}

/** Starts single sign-on: remembers state, nonce, and the PKCE verifier, then sends the person to the provider. */
export async function GET(request: NextRequest) {
  const settings = await loadSsoSettings();
  if (!settings?.enabled || !settings.issuer || !settings.clientId) return fail(request, "not-setup");
  let secret = "";
  try {
    secret = decryptSecret(settings.clientSecret);
  } catch {
    return fail(request, "secret");
  }
  try {
    const { client, config } = await providerConfig(settings, secret);
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(request),
      scope: "openid email profile",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    const response = NextResponse.redirect(url);
    response.cookies.set(FLOW_COOKIE, sealFlow({ state, nonce, verifier }), {
      httpOnly: true,
      // Lax so the cookie comes back on the provider's top-level redirect to the callback.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/oidc",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error("Single sign-on could not start", error);
    return fail(request, "unreachable");
  }
}
