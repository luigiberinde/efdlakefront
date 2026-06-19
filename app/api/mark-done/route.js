import { NextResponse } from "next/server";
import { requireLC, getAuthStatus } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status });
  const { portal } = await getAuthStatus();
  const { shiftId } = await req.json();
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("mark_todo_done", { p_shift_id: shiftId, p_portal: portal || "lakefront" });
  if (error) { console.error(error); return NextResponse.json({ success: false, error: "Database error" }, { status: 500 }); }
  if (!data?.success) return NextResponse.json(data || { success: false, error: "Shift is not available." }, { status: 400 });
  return NextResponse.json({ success: true });
}
