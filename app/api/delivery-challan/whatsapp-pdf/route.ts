import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// GET /api/delivery-challan/whatsapp-pdf?id=... - returns one queued
// Delivery Challan's stored PDF so the Courier Tracking page can (re)send it
// through the DEV WA Bulk Sender extension (e.g. rows left "Queued" by the
// retired whatsapp-bridge, or a FAILED send). pdfBase64 is "" once a send
// succeeded, so already-delivered rows can't be resent from here.
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "A valid id is required." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const doc = await db.collection("delivery_challan_whatsapp").findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    return NextResponse.json({
      success: true,
      record: {
        _id: String(doc._id),
        instituteName: doc.instituteName,
        whatsappNumber: doc.whatsappNumber,
        orderNos: doc.orderNos || [],
        fileName: doc.fileName,
        pdfBase64: doc.pdfBase64 || "",
        status: doc.status,
      },
    });
  } catch (error: any) {
    console.error("GET delivery-challan/whatsapp-pdf error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch PDF" }, { status: 500 });
  }
}
