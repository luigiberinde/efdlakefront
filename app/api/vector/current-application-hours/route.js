import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { refreshCurrentHoursForApplicantWeek, shiftLengthForCurrentHours } from "@/lib/current-hours-refresh";

export async function POST(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });

  try {
    const { shiftId, appId } = await req.json();

    if (!shiftId || !appId) {
      return NextResponse.json({ success: false, error: "Missing shiftId or appId." }, { status: 400 });
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

    const { data: app, error: appErr } = await sb
      .from("applications")
      .select("*")
      .eq("id", appId)
      .eq("shift_id", shiftId)
      .single();

    if (appErr || !app) {
      return NextResponse.json({ success: false, error: "Application not found." }, { status: 404 });
    }

    const shiftLength = shiftLengthForCurrentHours(shift);
    if (!shiftLength || shiftLength <= 0) {
      return NextResponse.json({
        success: false,
        error: "This shift is missing a Vector/LC shift length, so current projected hours cannot be calculated.",
      }, { status: 400 });
    }

    const refresh = await refreshCurrentHoursForApplicantWeek({
      sb,
      applicantEmail: app.applicant_email,
      applicantName: app.applicant_vector_full_name || app.applicant_name,
      shiftDate: shift.date,
      includeStatuses: ["pending"],
    });

    if (!refresh.success) {
      return NextResponse.json(refresh, { status: 400 });
    }

    const selected = refresh.updatedApplications.find((x) => Number(x.appId) === Number(appId)) || null;

    return NextResponse.json({
      success: true,
      checkedAt: refresh.checkedAt,
      shiftId,
      appId,
      shiftLength,
      vectorUser: refresh.vectorUser,
      currentWeekHours: refresh.currentWeekHours,
      weekStart: refresh.weekStart,
      weekEndExclusive: refresh.weekEndExclusive,
      applicationTime: selected?.applicationTime || {
        vectorWeekHours: app.applicant_vector_week_hours,
        projectedAfterApproval: app.applicant_vector_projected_hours ?? app.hours_after_shift,
        wouldBeOT: Boolean(app.applicant_vector_would_be_ot),
        checkedAt: app.applicant_vector_checked_at,
      },
      current: selected?.current || null,
      updatedApplications: refresh.updatedApplications,
      warnings: [
        ...((selected?.current?.wouldBeOT) ? ["Projected current Vector hours exceed 40."] : []),
        ...(refresh.updatedApplications.length > 1 ? [`Updated current Vector hours for ${refresh.updatedApplications.length} pending applications in this same week.`] : []),
      ],
    });
  } catch (err) {
    console.error("current application hours error", err);
    return NextResponse.json({
      success: false,
      error: err.message || "Could not check current Vector hours.",
    }, { status: 500 });
  }
}
