import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function POST(req) {
  try {
    const { applicationId, email } = await req.json();
    const cleanEmail = normalizeEmail(email);

    if (!applicationId) {
      return NextResponse.json({ success: false, error: "Missing application." }, { status: 400 });
    }

    const { lcAuth, portal } = await getAuthStatus();
    const sb = getServiceClient();

    const { data: app, error: appErr } = await sb
      .from("applications")
      .select("id, shift_id, applicant_email, applicant_name, status, shifts!inner(id, portal)")
      .eq("id", applicationId)
      .eq("shifts.portal", portal || "lakefront")
      .single();

    if (appErr || !app) {
      return NextResponse.json({ success: false, error: "Application not found." }, { status: 404 });
    }

    if (app.status !== "pending") {
      return NextResponse.json({ success: false, error: "Only pending applications can be deleted." }, { status: 400 });
    }

    if (!lcAuth && normalizeEmail(app.applicant_email) !== cleanEmail) {
      return NextResponse.json({ success: false, error: "Only this applicant or an LC can delete this application." }, { status: 403 });
    }

    const { error: deleteErr } = await sb
      .from("applications")
      .delete()
      .eq("id", applicationId)
      .eq("status", "pending");

    if (deleteErr) {
      console.error("delete-application error", deleteErr);
      return NextResponse.json({ success: false, error: "Could not delete this application." }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedApplication: app, deletedByLC: !!lcAuth });
  } catch (err) {
    console.error("delete-application route error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not delete this application." }, { status: 500 });
  }
}
