import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// "10-11-2026 1:00 PM" / "10-11-2026 13:00" / "10-11-2026 13:00:00" -> parts
function parseEnd(raw: string) {
  const m = String(raw || "")
    .trim()
    .match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let h = m[4] ? parseInt(m[4], 10) : 0;
  const ap = (m[7] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { d: +m[1], mo: +m[2], y: +m[3], h, mi: m[5] ? +m[5] : 0, s: m[6] ? +m[6] : 0 };
}
const p2 = (n: number) => String(n).padStart(2, "0");
function formatEndDate(raw: unknown): string {
  const p = parseEnd(String(raw || ""));
  return p ? `${p2(p.d)}-${p2(p.mo)}-${p.y} ${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}` : "";
}
// Compared to the minute - the listing may omit seconds.
function sameMoment(a: string, b: string): boolean {
  const x = parseEnd(a);
  const y = parseEnd(b);
  if (!x || !y) return a.trim() === b.trim();
  return x.d === y.d && x.mo === y.mo && x.y === y.y && x.h === y.h && x.mi === y.mi;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST { bidId, status?, error? } — reports one bid's result from a claimed
// GET /api/gem-bids/refresh-status batch. status (the literal text read off
// GeM) is written into bidStatus, same field the Bid Status column itself
// edits - a refresh and a manual edit are the same field either way, this
// is just an automated writer for it. error (no status found / fetch
// failed) still clears the "fetching" flag so the bid isn't stuck pending
// forever, but leaves bidStatus untouched.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, status, error } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const now = new Date();

    // Targeted field updates, not a whole-object overwrite - this used to
    // replace statusRefresh entirely, silently wiping batchId (see POST's
    // own comment) every time a bid finished, which broke .../progress's
    // ability to tell this run's bids apart from an earlier one.
    const set: Record<string, any> = {
      "statusRefresh.status": error ? "failed" : "done",
      "statusRefresh.finishedAt": now,
      "statusRefresh.error": error || null,
    };
    if (typeof status === "string" && status.trim()) {
      set.bidStatus = status.trim();
      set.lastModifiedBy = "GeM Bid Exporter (auto-refresh)";
      set.lastModifiedAt = now;
    }

    // GeM's listing End Date for this bid. If the deadline was extended/moved,
    // store it in the same "DD-MM-YYYY HH:mm:ss" form a sync writes, and log it.
    const bidsCollection = db.collection("gem_bids");
    const newEnd = formatEndDate(body.endDate);
    if (newEnd) {
      const existing = await bidsCollection.findOne({ _id: new ObjectId(bidId) }, { projection: { bidNo: 1, bidEndDateTime: 1 } });
      const oldEnd = String(existing?.bidEndDateTime || "").trim();
      if (existing && !sameMoment(oldEnd, newEnd)) {
        set.bidEndDateTime = newEnd;
        set.updatedAt = now;
        await db.collection("gem_bid_change_history").insertOne({
          bidNo: existing.bidNo,
          runId: null,
          fieldChanged: "bidEndDateTime",
          oldValue: oldEnd,
          newValue: newEnd,
          runTimestamp: now,
        });
      }
    }

    await bidsCollection.updateOne({ _id: new ObjectId(bidId) }, { $set: set });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid refresh-status complete error:", error);
    return NextResponse.json({ error: error.message || "Failed to record status" }, { status: 500, headers: corsHeaders });
  }
}
