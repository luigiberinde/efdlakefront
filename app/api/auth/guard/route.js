import { NextResponse } from "next/server";
import { createSession, normalizePortal } from "@/lib/auth";

export async function POST(req) {
  const { password, portal: requestedPortal } = await req.json();
  const portal = normalizePortal(requestedPortal);
  const expected = portal === "beach"
    ? (process.env.BEACH_ACCESS_PASSWORD || "beach")
    : process.env.GUARD_ACCESS_PASSWORD;

  if (!expected || password !== expected) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const token = await createSession(portal === "beach" ? "beach" : "guard");
  const res = NextResponse.json({ success: true, portal });
  res.cookies.set("guard_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 28800, path: "/" });
  res.cookies.delete("lc_session");
  return res;
}
