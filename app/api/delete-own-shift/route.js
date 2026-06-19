import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { currentPortalOrLakefront } from "@/lib/auth";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function POST(req) {
  try {
    const { shiftId, email } = await req.json();
    const cleanEmail = normalizeEmail(email);
    const portal = await currentPortalOrLakefront();

    if (!shiftId || !cleanEmail) {
      return NextResponse.json({ success: false, error: "Missing shift or email." }, { status: 400 });
    }

    const sb = getServiceClient();

    const { data: shift, error: shiftErr } = await sb
      .from("shifts")
      .select("id, poster_email, poster_name, date, type, time, status, portal")
      .eq("id", shiftId)
      .eq("portal", portal)
      .single();

    if (shiftErr || !shift) {
      return NextResponse.json({ success: false, error: "Shift not found." }, { status: 404 });
    }

    if (shift.status !== "open") {
      return NextResponse.json({ success: false, error: "This shift is no longer open." }, { status: 400 });
    }

    if (normalizeEmail(shift.poster_email) !== cleanEmail) {
      return NextResponse.json({ success: false, error: "Only the person who posted this shift can delete it this way." }, { status: 403 });
    }

    const { count: affectedApplications } = await sb
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("shift_id", shiftId)
      .eq("status", "pending");

    // applications are CASCADE-deleted, but explicitly deleting them first makes the behavior obvious.
    const { error: appDeleteErr } = await sb
      .from("applications")
      .delete()
      .eq("shift_id", shiftId);

    if (appDeleteErr) {
      console.error("delete-own-shift applications delete error", appDeleteErr);
      return NextResponse.json({ success: false, error: "Could not remove applications for this shift." }, { status: 500 });
    }

    const { error: shiftDeleteErr } = await sb
      .from("shifts")
      .delete()
      .eq("id", shiftId)
      .eq("portal", portal)
      .eq("status", "open");

    if (shiftDeleteErr) {
      console.error("delete-own-shift shift delete error", shiftDeleteErr);
      return NextResponse.json({ success: false, error: "Could not delete this shift." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletedShift: shift,
      affectedApplications: affectedApplications || 0,
    });
  } catch (err) {
    console.error("delete-own-shift route error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not delete this shift." }, { status: 500 });
  }
}
