import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { sendGmailMessage, isEmailEnabled } from "@/lib/gmail";

export async function GET(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status || 401 });

  if (!isEmailEnabled()) {
    return NextResponse.json({
      success: false,
      error: "EMAIL_ENABLED is not true.",
    }, { status: 400 });
  }

  const url = new URL(req.url);
  const to = url.searchParams.get("to") || process.env.GMAIL_SENDER_EMAIL;

  try {
    const result = await sendGmailMessage({
      to,
      subject: "Lakefront ShiftSwap email test",
      body:
        "This is a test email from Lakefront ShiftSwap.\n\n" +
        "If you received this, Gmail API sending is configured correctly.\n\n" +
        "Best,\nLCs",
    });

    return NextResponse.json({
      success: true,
      to,
      gmailMessageId: result?.id || null,
      result,
    });
  } catch (err) {
    console.error("email test failed", err);
    return NextResponse.json({
      success: false,
      error: err.message || "Email test failed.",
    }, { status: 500 });
  }
}
