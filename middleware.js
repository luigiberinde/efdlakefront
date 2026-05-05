import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/login", "/api/auth/", "/robots.txt", "/favicon.ico"];
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-fallback-change-me-32chars!!");

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some(p => pathname.startsWith(p)) || pathname.startsWith("/_next")) return NextResponse.next();

  // Accept either guard or LC session
  const gt = req.cookies.get("guard_session")?.value;
  const lt = req.cookies.get("lc_session")?.value;

  for (const token of [gt, lt]) {
    if (token) {
      try { await jwtVerify(token, secret()); return NextResponse.next(); } catch {}
    }
  }

  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete("guard_session");
  res.cookies.delete("lc_session");
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
