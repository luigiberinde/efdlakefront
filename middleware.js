// middleware.js

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

async function verifyJwtCookie(token) {
  try {
    if (!token || !process.env.JWT_SECRET) return null;

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    return payload || null;
  } catch {
    return null;
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Never gate API routes through the guard-login middleware.
  // Individual API routes protect themselves.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Let Next internals and static files through.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // Allow the login page.
  if (pathname === "/login") {
    return NextResponse.next();
  }

  const guardCookie = request.cookies.get("guard_session")?.value;
  const lcCookie = request.cookies.get("lc_session")?.value;

  const guardSession = await verifyJwtCookie(guardCookie);
  const lcSession = await verifyJwtCookie(lcCookie);

  // Lakefront LC/Admin and Beach Admin sessions also count as staff access.
  const guardRole = guardSession?.role;
  const adminRole = lcSession?.role;
  if (["guard", "beach"].includes(guardRole) || ["lc", "admin"].includes(adminRole)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};