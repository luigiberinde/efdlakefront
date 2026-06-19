import { NextResponse } from "next/server";
import { requireLakefrontLC as requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";

export async function POST(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: "Missing On-Call ID." }, { status: 400 });
    const sb = getServiceClient();
    const { data, error } = await sb.from("on_call_signups")
      .update({ status: "removed", removed_at: new Date().toISOString(), updated_at: new Date().toISOString(), note: "Removed by LC." })
      .eq("id", id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: "Could not find an active On-Call signup." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("on-call LC remove error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not remove On-Call signup." }, { status: 500 });
  }
}
