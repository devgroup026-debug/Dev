import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CourierRunLog from "@/models/CourierRunLog";
import { mergeCourierResults, processNewCourierParcels } from "@/lib/courier/parseAndMatch";

// PDF fetch + parse + match can take a few seconds - stay under Vercel's
// default 10s function timeout the same way /api/backup/auto does.
export const maxDuration = 60;

export async function GET() {
  try {
    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const todayDate = new Date().toISOString().split("T")[0];
    // Today's log is returned whatever its status - a failed Gmail auto-run
    // must not hide parcels that were already added today (e.g. by a manual
    // PDF upload); `error` on it is shown separately.
    const existingLog = await CourierRunLog.findOne({ date: todayDate });
    const recentLogs = await CourierRunLog.find().sort({ timestamp: -1 }).limit(10).lean();

    return NextResponse.json({
      success: true,
      todayRunCompleted: existingLog?.status === "SUCCESS",
      todayLog: existingLog || null,
      history: recentLogs,
      gmailConfigured: !!(process.env.GMAIL_API_CLIENT_ID && process.env.GMAIL_API_CLIENT_SECRET && process.env.GMAIL_API_REFRESH_TOKEN),
      gmailDisabled: process.env.COURIER_GMAIL_DISABLED === "true",
      courierSenderConfigured: !!process.env.COURIER_SENDER_EMAIL,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1) {
      if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI);
      } else {
        return NextResponse.json({ error: "MONGODB_URI missing" }, { status: 500 });
      }
    }

    const todayDate = new Date().toISOString().split("T")[0];

    let forceRun = false;
    try {
      const body = await req.json();
      forceRun = !!body?.force;
    } catch {
      // Body empty or invalid JSON, ignore
    }

    // Auto-triggered (app/layout.tsx, on every site access) is rate-limited by
    // a cooldown rather than "once per calendar day" - the courier can send
    // more than one email in a day (confirmed live 26-Aug-2026: mails at
    // 06:21 and 15:31 the same day), and a calendar-day gate meant whichever
    // one arrived AFTER the day's first auto-check sat unprocessed until
    // someone happened to hit "Run Now" or the next day's first login. The
    // cooldown still stops every single page navigation from hitting the
    // Gmail API, without silently going quiet for the rest of the day.
    // COURIER_GMAIL_DISABLED=true turns off the Gmail fetch entirely (e.g.
    // while the Gmail account/token is unusable) - courier PDFs then come in
    // only via the manual "Upload Courier PDF" button. Without this, the
    // site-visit auto-run would keep failing and flagging today's log.
    if (process.env.COURIER_GMAIL_DISABLED === "true") {
      return NextResponse.json(
        forceRun
          ? { error: "Gmail fetch band hai (COURIER_GMAIL_DISABLED=true) - 'Upload Courier PDF' se PDF daalo." }
          : { skipped: true, message: "Gmail fetch disabled (COURIER_GMAIL_DISABLED=true)." },
        { status: forceRun ? 400 : 200 }
      );
    }

    const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
    const lastSuccess = await CourierRunLog.findOne({ status: "SUCCESS" }).sort({ timestamp: -1 });
    const withinCooldown = !!lastSuccess && Date.now() - new Date(lastSuccess.timestamp).getTime() < COOLDOWN_MS;

    if (withinCooldown && !forceRun) {
      return NextResponse.json({
        skipped: true,
        message: `Courier already checked recently (at ${new Date(lastSuccess!.timestamp).toISOString()}) - next auto-check in a bit, or use Run Now.`,
        log: lastSuccess,
      });
    }

    // Lock today's entry to prevent concurrency collisions (e.g. two staff
    // logging in at nearly the same moment).
    await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      { status: "IN_PROGRESS", timestamp: new Date(), error: null },
      { upsert: true, new: true }
    );

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database instance unavailable");
    }

    const result = await processNewCourierParcels(db);

    // Merge, don't overwrite - today's list may already hold parcels from an
    // earlier run or a manual PDF upload, with WhatsApp statuses that must
    // survive.
    const existingToday = await CourierRunLog.findOne({ date: todayDate });
    const merged = mergeCourierResults(existingToday, result);

    const updatedLog = await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      {
        status: "SUCCESS",
        totalParcels: merged.matched.length + merged.needsReview.length,
        matchedCount: merged.matched.length,
        needsReviewCount: merged.needsReview.length,
        matched: merged.matched,
        needsReview: merged.needsReview,
        timestamp: new Date(),
        error: result.totalParcels === 0 ? "No new courier parcels found since the last fetch." : undefined,
        triggeredBy: forceRun ? "MANUAL_RUN_NOW" : "AUTO_SITE_ACCESS",
      },
      { new: true }
    );

    return NextResponse.json({
      success: true,
      message:
        result.totalParcels === 0
          ? "No new courier mail/parcels found since the last fetch - nothing to process."
          : `Processed ${result.totalParcels} parcels: ${result.matched.length} matched, ${result.needsReview.length} need review.`,
      log: updatedLog,
    });
  } catch (error: any) {
    console.error("Courier auto-run error:", error);

    const todayDate = new Date().toISOString().split("T")[0];
    await CourierRunLog.findOneAndUpdate(
      { date: todayDate },
      { status: "FAILED", error: error.message || "Unknown courier-run error", timestamp: new Date() },
      { upsert: true }
    );

    return NextResponse.json({ error: error.message || "Courier auto-run failed" }, { status: 500 });
  }
}
