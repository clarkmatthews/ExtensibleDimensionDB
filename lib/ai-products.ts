/**
 * The chat assistants that can sign in with OAuth, and the hosts their sign-in returns to.
 * Kept free of imports so next.config.ts can use it for the consent page's security policy.
 */
export const AI_PRODUCTS = {
  CHATGPT: { label: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"] },
  CLAUDE: { label: "Claude", hosts: ["claude.ai"] },
  GROK: { label: "Grok", hosts: ["grok.com", "grok.x.ai"] },
} as const;

/**
 * Where the consent form may send the browser after Allow or Cancel: this site, and each
 * assistant's host and subdomains. Browsers apply form-action to the redirect that follows a
 * form submission, so 'self' alone blocks the hand-back to the assistant.
 */
export function assistantFormTargets() {
  const hosts = Object.values(AI_PRODUCTS).flatMap((product) => product.hosts);
  return ["'self'", ...hosts.flatMap((host) => [`https://${host}`, `https://*.${host}`])].join(" ");
}
