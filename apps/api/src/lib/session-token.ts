import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7;

export interface SessionPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  exp: number;
}

function secret(): string {
  return process.env.AUTH_SECRET ?? "wms-dev-secret-change-in-production";
}

export function signSession(
  user: { id: string; email: string; role: string; permissions: string[] },
  ttlSec = DEFAULT_TTL_SEC,
): string {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!Array.isArray(payload.permissions)) {
      payload.permissions = [];
    }
    return payload;
  } catch {
    return null;
  }
}
