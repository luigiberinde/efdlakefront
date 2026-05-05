import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/auth";
export async function GET() {
  return NextResponse.json(await getAuthStatus());
}
