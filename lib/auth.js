import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const getSecret = () => new TextEncoder().encode(process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-fallback-change-me-32chars!!");

export async function createSession(role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(role === "lc" ? "4h" : "8h")
    .sign(getSecret());
}

export async function verifySession(token) {
  try { return (await jwtVerify(token, getSecret())).payload; }
  catch { return null; }
}

export async function getAuthStatus() {
  const c = await cookies();
  const gp = c.get("guard_session")?.value;
  const lp = c.get("lc_session")?.value;
  const g = gp ? await verifySession(gp) : null;
  const l = lp ? await verifySession(lp) : null;
  return { guardAuth: !!g || !!(l?.role === "lc"), lcAuth: !!(l?.role === "lc") };
}

export async function requireLC() {
  const { lcAuth } = await getAuthStatus();
  if (!lcAuth) return { error: "LC authentication required", status: 403 };
  return null;
}
