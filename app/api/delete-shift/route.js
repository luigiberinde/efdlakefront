import { NextResponse } from "next/server";
import { requireLC, getAuthStatus } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { buildDeletionNotifications } from "@/lib/notifications";

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status });

  const { portal } = await getAuthStatus();
  const { shiftId } = await req.json();
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("delete_open_shift", { p_shift_id: shiftId, p_portal: portal || "lakefront" });
  if (error || !data?.success) return NextResponse.json(data || { success: false, error: "Failed" }, { status: error ? 500 : 400 });

  const emailOn = process.env.EMAIL_ENABLED === "true";
  const notifs = buildDeletionNotifications(data.deleted_shift, data.affected_applicants);
  if (notifs.length) {
    await sb.from("notifications").insert(notifs.map(n => ({ ...n, status: emailOn ? "pending" : "skipped" })));
  }

  return NextResponse.json({ success: true });
}
