import { NextResponse } from "next/server";
import { validatePersonDate } from "@/lib/vector-core";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await validatePersonDate({
      email: body.email,
      name: body.name,
      date: body.date,
      publicStrictEmail: body.publicStrictEmail !== false,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        allowed: false,
        decision: "error",
        error: err.message || "Vector validation failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
