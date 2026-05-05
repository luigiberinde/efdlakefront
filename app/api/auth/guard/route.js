import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
export async function POST(req) {
  const { password } = await req.json();
  if (password !== process.env.GUARD_ACCESS_PASSWORD)
    return NextResponse.json({ success: false }, { status: 401 });
  const token = await createSession("guard");
  const res = NextResponse.json({ success: true });
  res.cookies.set("guard_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 28800, path: "/" });
  return res;
}
