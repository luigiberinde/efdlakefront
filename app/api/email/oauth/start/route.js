import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { buildGoogleOAuthUrl } from "@/lib/gmail";

export async function GET(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status || 401 });

  const state = crypto.randomUUID();
  const url = buildGoogleOAuthUrl(state);

  return NextResponse.redirect(url);
}
