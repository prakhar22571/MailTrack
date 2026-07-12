import type { Context, Next } from "hono";
import type { Env, Variables } from "../types";

/**
 * Resolves the caller's user row from the X-Api-Key header, creating it on
 * first sight. There's no signup flow: the extension mints a random key on
 * install and this endpoint is what turns it into a real user.
 */
export async function requireUser(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
) {
  const apiKey = c.req.header("X-Api-Key");
  if (!apiKey || apiKey.length < 16) {
    return c.json({ error: "missing or invalid X-Api-Key header" }, 401);
  }

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO users (api_key) VALUES (?)",
  )
    .bind(apiKey)
    .run();

  const row = await c.env.DB.prepare(
    "SELECT id FROM users WHERE api_key = ?",
  )
    .bind(apiKey)
    .first<{ id: number }>();

  if (!row) {
    return c.json({ error: "failed to resolve user" }, 500);
  }

  c.set("userId", row.id);
  await next();
}

/** Drops the last IPv4 octet / last two IPv6 groups so we log a coarse location, not a precise one. */
export function coarsenIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, Math.max(1, parts.length - 2)).join(":") + "::";
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}
