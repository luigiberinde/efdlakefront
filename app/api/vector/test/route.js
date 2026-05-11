// app/api/vector/test/route.js

import { getVectorAccessToken, requireVectorDebugAccess } from "@/lib/vector-client";

export async function GET(request) {
  try {
    requireVectorDebugAccess(request);

    const token = await getVectorAccessToken({ forceRefresh: true });

    return Response.json({
      ok: true,
      authenticated: true,
      tokenReceived: Boolean(token),
      tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
      note: "Vector auth works. Token intentionally not returned.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message || "Vector auth test failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
