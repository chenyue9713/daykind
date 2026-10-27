import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of `Authorization: Bearer <secret>`. Both sides are
 * hashed first so the comparison does not leak the secret's length.
 */
export function isAuthorizedDispatch(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match || !secret) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}
