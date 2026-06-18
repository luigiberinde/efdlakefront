import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { normalizeEmail } from "@/lib/vector-core";

function chicagoTodayStr() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function POST(req) {
  try {
    const { email } = await req.json();
    const normalized = normalizeEmail(email);
    if (!normalized) return NextResponse.json({ success: false, error: "Missing email." }, { status: 400 });
    const sb = getServiceClient();
    const today = chicagoTodayStr();
    await sb.from("on_call_signups")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("normalized_email", normalized)
      .eq("status", "active")
      .lt("date", today);
    const { data, error } = await sb.from("on_call_signups")
      .select("*")
      .eq("normalized_email", normalized)
      .eq("status", "active")
      .gte("date", today)
      .order("date", { ascending: true })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ success: true, signups: data || [] });
  } catch (err) {
    console.error("on-call my activity error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not load On-Call signups." }, { status: 500 });
  }
}
