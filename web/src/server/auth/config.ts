import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import nextEnv from "@next/env";
import { getPool } from "@/server/db/pool";

nextEnv.loadEnvConfig(process.cwd());

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for authentication.`);
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function sendMagicLink(email: string, url: string): Promise<void> {
  const hostname = new URL(requiredEnv("BETTER_AUTH_URL")).hostname.replace(/^\[|\]$/g, "");
  if (
    process.env.NODE_ENV === "development" &&
    ["localhost", "127.0.0.1", "::1"].includes(hostname)
  ) {
    console.info(`Local test sign-in link for ${email}: ${url}`);
    return;
  }

  // Signup is open. Better Auth's verification link establishes email control;
  // provider rate limits and app rate limits constrain automated abuse.
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = requiredEnv("AUTH_EMAIL_FROM");
  const safeUrl = escapeHtml(url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your Carpool Pakistan sign-in link",
      text: `Sign in to Carpool Pakistan using this one-time link (expires in 5 minutes): ${url}`,
      html: `<p>Use this one-time link to sign in to Carpool Pakistan. It expires in 5 minutes.</p><p><a href="${safeUrl}">Sign in</a></p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed with status ${response.status}.`);
  }
}

const baseURL = requiredEnv("BETTER_AUTH_URL");
const authSecret = requiredEnv("AUTH_SECRET");
if (authSecret.length < 32 || authSecret.includes("replace-with")) {
  throw new Error("Set AUTH_SECRET to a random value of at least 32 characters.");
}
const trustedOrigin = new URL(baseURL).origin;
if (process.env.NODE_ENV === "production" && !trustedOrigin.startsWith("https://")) {
  throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
}

export const auth = betterAuth({
  appName: "Carpool Pakistan",
  baseURL,
  secret: authSecret,
  trustedOrigins: [trustedOrigin],
  database: getPool(),
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 10,
    max: 100,
  },
  session: {
    expiresIn: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  plugins: [
    magicLink({
      expiresIn: 5 * 60,
      rateLimit: { window: 60, max: 5 },
      storeToken: "hashed",
      sendMagicLink: ({ email, url }) => sendMagicLink(email, url),
    }),
  ],
});
