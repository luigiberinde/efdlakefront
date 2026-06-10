import { NextResponse } from "next/server";
import { addDays, findVectorUser, getScheduleRows, findUserShifts, normalizeEmail, requiredDate } from "@/lib/vector-core";

function cleanText(v) { return String(v || "").trim(); }
function daysBetween(start, endExclusive) {
  const a = new Date(start + "T12:00:00Z");
  const b = new Date(endExclusive + "T12:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function sortKey(s) { return `${s.day_date || ""} ${s.shift_start || ""} ${s.shift_end || ""} ${s.assignment_name || ""}`; }
function todayChicago() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function stableShiftKey(s, index) {
  return [
    s?.day_date || "",
    s?.shift_start || "",
    s?.shift_end || "",
    s?.assignment_id || "",
    s?.shift_id || "",
    s?.work_type_id || "",
    index,
  ].join("::");
}

export async function POST(req) {
  try {
    const body = await req.json();
    const name = cleanText(body.name);
    const email = normalizeEmail(body.email);
    const startDate = requiredDate(cleanText(body.startDate), "startDate");
    const endDateInclusive = requiredDate(cleanText(body.endDate), "endDate");
    const endExclusive = addDays(endDateInclusive, 1);

    if (!name || !email) {
      return NextResponse.json({ success: false, error: "Enter your name and email first." }, { status: 400 });
    }
    if (endExclusive <= startDate) {
      return NextResponse.json({ success: false, error: "Choose a valid date range." }, { status: 400 });
    }
    const today = todayChicago();
    if (startDate < today || endDateInclusive < today) {
      return NextResponse.json({ success: false, error: "You cannot post or load shifts before today's date." }, { status: 400 });
    }
    if (daysBetween(startDate, endExclusive) > 45) {
      return NextResponse.json({ success: false, error: "Choose a range of 45 days or less so Vector does not get slow." }, { status: 400 });
    }

    const userResult = await findVectorUser({ email, name, publicStrictEmail: true });
    if (!userResult.ok) {
      return NextResponse.json({ success: false, error: "Vector could not confidently match this person. Double-check the name/email or contact an LC.", reason: userResult.blockReason }, { status: 400 });
    }

    const rows = await getScheduleRows(startDate, endExclusive);
    const shifts = findUserShifts(rows, userResult.user)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .map((shift, index) => ({ ...shift, __bulk_key: stableShiftKey(shift, index) }));

    return NextResponse.json({
      success: true,
      vectorUser: userResult.user,
      startDate,
      endDate: endDateInclusive,
      shifts,
    });
  } catch (err) {
    console.error("person-shifts route error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not load Vector shifts." }, { status: 500 });
  }
}
