import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
export async function POST(req) {
  const { password } = await req.json();
  if (password !== process.env.LC_ACCESS_PASSWORD)
    return NextResponse.json({ success: false }, { status: 401 });
  const token = await createSession("lc");
  const res = NextResponse.json({ success: true });
  res.cookies.set("lc_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 14400, path: "/" });
  return res;
}
