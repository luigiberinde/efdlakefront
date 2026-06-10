import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { normalizeEmail } from "@/lib/vector-core";

function cleanText(v) { return String(v || "").trim(); }
function cleanEmail(v) { return normalizeEmail(v); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(email)); }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")); }
function filtersOverlap(aStart, aEnd, bStart, bEnd) { return String(aStart) <= String(bEnd) && String(bStart) <= String(aEnd); }

export async function POST(req) {
  try {
    const body = await req.json();
    const name = cleanText(body.name);
    const email = cleanEmail(body.email);
    const type = body.type === "guard" || body.type === "manager" ? body.type : "any";
    const time = body.time === "early" || body.time === "late" ? body.time : "any";
    const startDate = cleanText(body.startDate);
    const endDate = cleanText(body.endDate);

    if (!name || !isValidEmail(email)) {
      return NextResponse.json({ success: false, error: "Enter your name and a valid email." }, { status: 400 });
    }
    if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) {
      return NextResponse.json({ success: false, error: "Enter a valid date range." }, { status: 400 });
    }

    const sb = getServiceClient();

    // Avoid saving exact duplicate Notify Me alerts. Overlapping alerts are allowed,
    // but post-time sending dedupes by email so a person receives only one email per posted shift.
    const { data: existing, error: existingError } = await sb.from("shift_watch_requests")
      .select("id, type, time, start_date, end_date, status")
      .eq("status", "active")
      .ilike("email", email)
      .limit(100);
    if (existingError) throw existingError;

    const exactDuplicate = (existing || []).find(w =>
      w.type === type && w.time === time && String(w.start_date) === startDate && String(w.end_date) === endDate
    );
    if (exactDuplicate) {
      return NextResponse.json({ success: true, duplicate: true, watchId: exactDuplicate.id, message: "That notification already exists." });
    }

    const overlapping = (existing || []).filter(w => filtersOverlap(w.start_date, w.end_date, startDate, endDate)).length;

    const { data, error } = await sb.from("shift_watch_requests").insert({
      name,
      email,
      type,
      time,
      start_date: startDate,
      end_date: endDate,
      status: "active",
    }).select("id").single();
    if (error) {
      console.error("watch-shifts insert error", error);
      return NextResponse.json({ success: false, error: error.message || "Could not save notification." }, { status: 500 });
    }
    return NextResponse.json({ success: true, watchId: data?.id || null, overlapping });
  } catch (err) {
    console.error("watch-shifts route error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not save notification." }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const watchId = Number(body.watchId);
    const email = cleanEmail(body.email);
    if (!watchId || !isValidEmail(email)) {
      return NextResponse.json({ success: false, error: "Missing notification ID or email." }, { status: 400 });
    }

    const sb = getServiceClient();
    const { data: existing, error: lookupError } = await sb.from("shift_watch_requests")
      .select("id, email, status")
      .eq("id", watchId)
      .single();
    if (lookupError || !existing) {
      return NextResponse.json({ success: false, error: "Notification not found." }, { status: 404 });
    }
    if (cleanEmail(existing.email) !== email) {
      return NextResponse.json({ success: false, error: "This email does not match that notification." }, { status: 403 });
    }

    const { error } = await sb.from("shift_watch_requests")
      .update({ status: "inactive" })
      .eq("id", watchId);
    if (error) {
      console.error("watch-shifts unsubscribe error", error);
      return NextResponse.json({ success: false, error: error.message || "Could not unsubscribe." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("watch-shifts unsubscribe route error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not unsubscribe." }, { status: 500 });
  }
}
