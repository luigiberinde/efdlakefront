import { NextResponse } from "next/server";
import { checkApplicationEligibility } from "@/lib/vector-core";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await checkApplicationEligibility({
      email: body.email,
      name: body.name,
      shiftDate: body.shiftDate || body.date,
      postedShiftLength: body.postedShiftLength ?? body.shiftLength,
      publicStrictEmail: body.publicStrictEmail !== false,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        allowed: false,
        decision: "error",
        error: err.message || "Vector application eligibility check failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
