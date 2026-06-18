import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { normalizeEmail } from "@/lib/vector-core";

export async function POST(req) {
  try {
    const { id, email } = await req.json();
    const normalized = normalizeEmail(email);
    if (!id || !normalized) return NextResponse.json({ success: false, error: "Missing On-Call ID or email." }, { status: 400 });
    const sb = getServiceClient();
    const { data, error } = await sb.from("on_call_signups").update({ status: "removed", removed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("normalized_email", normalized).eq("status", "active").select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: "Could not find an active On-Call signup for that email." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("on-call remove error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not remove On-Call signup." }, { status: 500 });
  }
}
