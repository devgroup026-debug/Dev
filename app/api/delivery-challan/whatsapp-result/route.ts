import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// POST /api/delivery-challan/whatsapp-result - called from the browser
// (components/WaExtensionSync.tsx) with the Sent/Failed results the
// DEV WA Bulk Sender extension recorded for Delivery Challan PDFs. Replaces
// the old whatsapp-bridge's /api/delivery-challan/mark-whatsapp-sent callback.
// Body: { updates: [{ id, status: "SENT" | "FAILED", errorMessage? }] }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ error: "A non-empty updates array is required." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const coll = db.collection("delivery_challan_whatsapp");

    let applied = 0;
    for (const u of updates) {
      const { id, status, errorMessage } = u || {};
      if (!id || !ObjectId.isValid(id) || (status !== "SENT" && status !== "FAILED")) continue;
      const $set: Record<string, any> = {
        status,
        sentAt: status === "SENT" ? new Date() : null,
        errorMessage: status === "FAILED" ? errorMessage || "Send failed" : null,
      };
      // Keep the PDF on failure so the row can be re-sent from Courier
      // Tracking; drop it once delivered so the collection doesn't grow.
      if (status === "SENT") $set.pdfBase64 = "";
      const result = await coll.updateOne({ _id: new ObjectId(id) }, { $set });
      if (result.matchedCount > 0) applied++;
    }

    return NextResponse.json({ success: true, applied });
  } catch (error: any) {
    console.error("POST delivery-challan/whatsapp-result error:", error);
    return NextResponse.json({ error: error.message || "Failed to save WhatsApp results" }, { status: 500 });
  }
}
