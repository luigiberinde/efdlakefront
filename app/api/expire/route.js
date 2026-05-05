import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
export async function POST() {
  const { data } = await getServiceClient().rpc("expire_past_shifts");
  return NextResponse.json(data || { success: true });
}
