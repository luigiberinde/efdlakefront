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
    const { data, error } = await sb
      .from("on_call_signups")
      .update({ todo_complete: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "used")
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: "Could not find an approved On-Call signup." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("on-call mark done error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not mark On-Call done." }, { status: 500 });
  }
}
