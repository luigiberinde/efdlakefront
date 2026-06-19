import { NextResponse } from "next/server";
import { createSession, getAuthStatus, normalizePortal } from "@/lib/auth";

export async function POST(req) {
  const { password, portal: requestedPortal } = await req.json();
  const status = await getAuthStatus();
  const portal = normalizePortal(requestedPortal || status.portal);
  const expected = portal === "beach"
    ? (process.env.BEACH_ADMIN_PASSWORD || "DempDemp")
    : process.env.LC_ACCESS_PASSWORD;

  if (!expected || password !== expected) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const adminRole = portal === "beach" ? "admin" : "lc";
  const token = await createSession(adminRole);
  const staffToken = await createSession(portal === "beach" ? "beach" : "guard");
  const res = NextResponse.json({ success: true, portal, adminRole });
  res.cookies.set("lc_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 14400, path: "/" });
  res.cookies.set("guard_session", staffToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 28800, path: "/" });
  return res;
}
