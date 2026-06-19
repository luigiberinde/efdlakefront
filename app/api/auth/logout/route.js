import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete("guard_session");
  res.cookies.delete("lc_session");
  return res;
}
