import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";

// POST /api/courier/whatsapp-result - called from the browser
// (components/WaExtensionSync.tsx) with the Sent/Failed results the
// DEV WA Bulk Sender extension recorded for courier messages queued from the
// Courier Tracking page. Replaces the old whatsapp-bridge's
// /api/courier/mark-whatsapp-sent callback.
// Body: { updates: [{ date, docketNo, status: "SENT" | "FAILED" }] }
export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const body = await req.json();
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ error: "A non-empty updates array is required." }, { status: 400 });
    }

    let applied = 0;
    const notFound: string[] = [];

    for (const u of updates) {
      const { date, docketNo, status } = u || {};
      if (!date || !docketNo || (status !== "SENT" && status !== "FAILED")) continue;
      const result = await CourierRunLog.updateOne(
        { date, "matched.docketNo": docketNo },
        { $set: { "matched.$.whatsappStatus": status } }
      );
      if (result.matchedCount > 0) applied++;
      else notFound.push(`${date}/${docketNo}`);
    }

    // Unknown parcels still return 200 - the caller acks them so the
    // extension doesn't keep re-reporting a result nothing can store.
    return NextResponse.json({ success: true, applied, notFound });
  } catch (error: any) {
    console.error("POST courier/whatsapp-result error:", error);
    return NextResponse.json({ error: error.message || "Failed to save WhatsApp results" }, { status: 500 });
  }
}
