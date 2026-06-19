import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const getSecret = () => new TextEncoder().encode(process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-fallback-change-me-32chars!!");

export function normalizePortal(value) {
  return value === "beach" ? "beach" : "lakefront";
}

export function portalForRole(role) {
  if (role === "beach" || role === "admin") return "beach";
  return "lakefront";
}

export function isAdminRole(role) {
  return role === "lc" || role === "admin";
}

export function roleOptionsForPortal(portal) {
  return normalizePortal(portal) === "beach"
    ? ["gate_attendant", "office_staff"]
    : ["guard", "manager"];
}

export function defaultShiftTypeForPortal(portal) {
  return normalizePortal(portal) === "beach" ? "gate_attendant" : "guard";
}

export function normalizeShiftTypeForPortal(type, portal) {
  const allowed = roleOptionsForPortal(portal);
  return allowed.includes(type) ? type : defaultShiftTypeForPortal(portal);
}

export async function createSession(role) {
  const safeRole = ["guard", "beach", "lc", "admin"].includes(role) ? role : "guard";
  return new SignJWT({ role: safeRole, portal: portalForRole(safeRole) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(isAdminRole(safeRole) ? "4h" : "8h")
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

  const adminRole = isAdminRole(l?.role) ? l.role : null;
  const staffRole = ["guard", "beach"].includes(g?.role) ? g.role : null;
  const effectiveRole = adminRole || staffRole || null;
  const portal = effectiveRole ? portalForRole(effectiveRole) : null;

  return {
    guardAuth: !!effectiveRole,
    lcAuth: adminRole === "lc" || adminRole === "admin",
    adminAuth: adminRole === "admin",
    lakefrontAdminAuth: adminRole === "lc",
    beachAdminAuth: adminRole === "admin",
    role: effectiveRole,
    portal,
    portalLabel: portal === "beach" ? "Beach Staff" : portal === "lakefront" ? "Lakefront" : null,
  };
}

export async function requireLC() {
  const { lcAuth } = await getAuthStatus();
  if (!lcAuth) return { error: "Admin authentication required", status: 403 };
  return null;
}

export async function requireLakefrontLC() {
  const { lakefrontAdminAuth } = await getAuthStatus();
  if (!lakefrontAdminAuth) return { error: "LC authentication required", status: 403 };
  return null;
}

export async function currentPortalOrLakefront() {
  const status = await getAuthStatus();
  return normalizePortal(status.portal);
}
