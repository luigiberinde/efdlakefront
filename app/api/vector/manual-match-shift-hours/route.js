import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePersonDate } from "@/lib/vector-core";
import { liveVectorPatch } from "@/lib/current-hours-refresh";

function normalizePrefix(prefix) {
  return prefix === "swap_partner" ? "swap_partner" : "poster";
}

function prefixContext(shift, prefix) {
  if (prefix === "swap_partner") {
    return {
      date: shift.swap_partner_date,
      email: shift.swap_partner_vector_email || shift.swap_partner_email,
      name: shift.swap_partner_vector_full_name || shift.swap_partner_name,
    };
  }
  return {
    date: shift.date,
    email: shift.poster_vector_email || shift.poster_email,
    name: shift.poster_vector_full_name || shift.poster_name,
  };
}

export async function POST(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });

  try {
    const { shiftId, prefix: rawPrefix, vectorShiftId } = await req.json();
    const prefix = normalizePrefix(rawPrefix);

    if (!shiftId || !vectorShiftId) {
      return NextResponse.json({ success: false, error: "Missing shiftId or vectorShiftId." }, { status: 400 });
    }

    const sb = getServiceClient();
    const { data: shift, error: shiftErr } = await sb
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .single();

    if (shiftErr || !shift) {
      return NextResponse.json({ success: false, error: "Shift not found." }, { status: 404 });
    }

    const ctx = prefixContext(shift, prefix);
    if (!ctx.date || (!ctx.email && !ctx.name)) {
      return NextResponse.json({ success: false, error: "This posted shift is missing the person/date needed to match Vector." }, { status: 400 });
    }

    const check = await validatePersonDate({
      email: ctx.email,
      name: ctx.name,
      date: String(ctx.date).slice(0, 10),
      publicStrictEmail: Boolean(ctx.email),
    });

    if (!check?.allowed || !Array.isArray(check.shifts) || check.shifts.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Vector does not show this person scheduled on that date anymore.",
        check,
      }, { status: 400 });
    }

    const selected = check.shifts.find((row) => String(row.shift_id) === String(vectorShiftId));
    if (!selected) {
      return NextResponse.json({
        success: false,
        error: "That Vector shift is not assigned to this person on this date. Pick one of the listed candidate shifts.",
        check,
      }, { status: 400 });
    }

    const patch = liveVectorPatch(prefix, selected);
    const { data: updated, error: updateErr } = await sb
      .from("shifts")
      .update(patch)
      .eq("id", shift.id)
      .select("*")
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      shift: updated,
      prefix,
      matched: {
        shift_id: selected.shift_id,
        assignment_name: selected.assignment_name,
        work_type_name: selected.work_type_name,
        shift_start: selected.shift_start,
        shift_end: selected.shift_end,
        shift_length: patch[`${prefix}_vector_shift_length`],
        user_name: selected.user_name,
      },
    });
  } catch (err) {
    console.error("manual vector shift match error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not update this Vector shift match." }, { status: 500 });
  }
}
