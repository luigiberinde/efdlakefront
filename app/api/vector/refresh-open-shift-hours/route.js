import { NextResponse } from "next/server";
import { requireLC, getAuthStatus } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { refreshStoredShiftVectorLengths, shiftLengthForCurrentHours } from "@/lib/current-hours-refresh";

export async function POST() {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });
  const { portal } = await getAuthStatus();

  try {
    const sb = getServiceClient();
    const { data: shifts, error } = await sb
      .from("shifts")
      .select("*")
      .eq("portal", portal || "lakefront")
      .eq("status", "open")
      .order("date", { ascending: true })
      .limit(250);

    if (error) throw error;

    const summary = {
      checked: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      changed: [],
      standardizedFallbacks: [],
      skippedDetails: [],
      failedDetails: [],
    };

    for (const shift of shifts || []) {
      summary.checked += 1;
      const beforePoster = shiftLengthForCurrentHours(shift);
      const beforePosterShiftId = shift.poster_vector_shift_id || null;
      const beforeSwap = Number(shift.swap_partner_vector_shift_length || 0);
      const beforeSwapShiftId = shift.swap_partner_vector_shift_id || null;

      try {
        const result = await refreshStoredShiftVectorLengths({ sb, shift, updateDb: true, ignoreStoredShiftId: true, allowNameFallback: true, forceStandardBucketFallback: true });
        const refreshedShift = result.shift || shift;
        const afterPoster = shiftLengthForCurrentHours(refreshedShift);
        const afterPosterShiftId = refreshedShift.poster_vector_shift_id || null;
        const afterSwap = Number(refreshedShift.swap_partner_vector_shift_length || 0);
        const afterSwapShiftId = refreshedShift.swap_partner_vector_shift_id || null;

        if (result.refreshed?.length) summary.refreshed += 1;
        if (result.skipped?.length && !result.refreshed?.length) summary.skipped += 1;
        if (result.failed?.length) summary.failed += 1;

        if (beforePoster !== afterPoster || beforeSwap !== afterSwap || String(beforePosterShiftId || "") !== String(afterPosterShiftId || "") || String(beforeSwapShiftId || "") !== String(afterSwapShiftId || "")) {
          summary.changed.push({
            id: shift.id,
            date: shift.date,
            type: shift.type,
            time: shift.time,
            beforePosterVectorShiftId: beforePosterShiftId,
            afterPosterVectorShiftId: afterPosterShiftId,
            beforePosterLength: beforePoster,
            afterPosterLength: afterPoster,
            beforeSwapVectorShiftId: beforeSwapShiftId,
            afterSwapVectorShiftId: afterSwapShiftId,
            beforeSwapLength: beforeSwap || null,
            afterSwapLength: afterSwap || null,
          });
        }

        const standardFallbacks = (result.refreshed || []).filter(r => r.method === "standard_bucket_length_fallback");
        if (standardFallbacks.length) {
          summary.standardizedFallbacks.push({
            id: shift.id,
            date: shift.date,
            type: shift.type,
            time: shift.time,
            fallbacks: standardFallbacks,
          });
        }

        if (result.skipped?.length) {
          summary.skippedDetails.push({ id: shift.id, date: shift.date, skipped: result.skipped });
        }
        if (result.failed?.length) {
          summary.failedDetails.push({ id: shift.id, date: shift.date, failed: result.failed });
        }
      } catch (err) {
        summary.failed += 1;
        summary.failedDetails.push({ id: shift.id, date: shift.date, error: err.message || "Refresh failed." });
      }
    }

    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("refresh open shift hours error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not refresh open shift hours." }, { status: 500 });
  }
}
