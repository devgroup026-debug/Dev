import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";
import {
  extractCourierPdfText,
  loadCourierMatchContext,
  mergeCourierResults,
  parseAndMatchCourierText,
  type ProcessResult,
} from "@/lib/courier/parseAndMatch";

export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// POST /api/courier/upload-pdf - manual alternative to the Gmail auto-run:
// staff upload the courier's booking-register PDF(s) on the Courier
// Tracking page. Same parse + institute-match as the Gmail path; results are
// MERGED into today's CourierRunLog (a docket already listed keeps its
// WhatsApp status / manual institute fix), so uploading the same PDF twice
// is harmless. WhatsApp sending stays a separate, manual step.
// multipart/form-data, field "files" (one or more PDFs).
export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1) {
      if (!process.env.MONGODB_URI) {
        return NextResponse.json({ error: "MONGODB_URI missing" }, { status: 500 });
      }
      await mongoose.connect(process.env.MONGODB_URI);
    }
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database instance unavailable");

    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    if (files.length === 0) {
      return NextResponse.json({ error: "Koi PDF file nahi mili." }, { status: 400 });
    }

    const todayDate = new Date().toISOString().split("T")[0];
    const ctx = await loadCourierMatchContext(db);
    const combined: ProcessResult = { matched: [], needsReview: [], totalParcels: 0 };
    const perFile: { name: string; parcels: number; error?: string }[] = [];

    for (const file of files) {
      const name = file.name || "upload.pdf";
      if (!/\.pdf$/i.test(name) && file.type !== "application/pdf") {
        perFile.push({ name, parcels: 0, error: "PDF file nahi hai" });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        perFile.push({ name, parcels: 0, error: "10MB se badi file" });
        continue;
      }
      try {
        const text = await extractCourierPdfText(Buffer.from(await file.arrayBuffer()));
        const r = parseAndMatchCourierText(text, ctx, todayDate);
        combined.matched.push(...r.matched);
        combined.needsReview.push(...r.needsReview);
        combined.totalParcels += r.totalParcels;
        perFile.push({
          name,
          parcels: r.totalParcels,
          error: r.totalParcels === 0 ? "Is PDF me koi parcel line nahi mili (format alag hai?)" : undefined,
        });
      } catch (err: any) {
        perFile.push({ name, parcels: 0, error: err.message || "PDF padh nahi paye" });
      }
    }

    if (combined.totalParcels === 0) {
      return NextResponse.json(
        { error: "Upload ki gayi PDF(s) me koi parcel nahi mila.", files: perFile },
        { status: 422 }
      );
    }

    const existing = await CourierRunLog.findOne({ date: todayDate });
    const merged = mergeCourierResults(existing, combined);

    const log = await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      {
        $set: {
          status: "SUCCESS",
          matched: merged.matched,
          needsReview: merged.needsReview,
          matchedCount: merged.matched.length,
          needsReviewCount: merged.needsReview.length,
          totalParcels: merged.matched.length + merged.needsReview.length,
          timestamp: new Date(),
          error: null,
          triggeredBy: "MANUAL_PDF_UPLOAD",
        },
      },
      { upsert: true, new: true }
    );

    const newMatched = combined.matched.length;
    const newReview = combined.needsReview.length;
    return NextResponse.json({
      success: true,
      message:
        `${combined.totalParcels} parcel mile: ${newMatched} matched, ${newReview} review me.` +
        (merged.alreadyPresent ? ` ${merged.alreadyPresent} pehle se list me the (unka status same rakha).` : ""),
      files: perFile,
      log,
    });
  } catch (error: any) {
    console.error("POST courier/upload-pdf error:", error);
    return NextResponse.json({ error: error.message || "PDF upload failed" }, { status: 500 });
  }
}
