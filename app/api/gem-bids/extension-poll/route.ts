import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Same threshold as refresh-status/route.ts's STUCK_FETCHING_MS - a bid
// stuck "fetching" past this is reclaimed by that route's GET, so it counts
// as work waiting here too.
const STUCK_FETCHING_MS = 3 * 60 * 1000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET — one cheap "is there anything for you to do?" check for the GeM Bid
// Exporter's once-a-minute alarm. It used to call sync/status,
// fetch-documents and refresh-status on every tick (3 function invocations
// per minute, 24x7, per installed browser) even when all three had nothing
// to hand out. Now the extension calls only this, and hits the real
// endpoint(s) only when the matching flag is true. Read-only - claiming
// still happens in those endpoints exactly as before.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bids = db.collection("gem_bids");

    const [latestRun, docFetch, statusRefresh] = await Promise.all([
      db
        .collection("gem_bid_sync_runs")
        .findOne({}, { sort: { startedAt: -1 }, projection: { status: 1 } }),
      bids.findOne({ "docFetch.status": "pending" }, { projection: { _id: 1 } }),
      bids.findOne(
        {
          $or: [
            { "statusRefresh.status": "pending" },
            {
              "statusRefresh.status": "fetching",
              "statusRefresh.requestedAt": { $lt: new Date(Date.now() - STUCK_FETCHING_MS) },
            },
          ],
        },
        { projection: { _id: 1 } }
      ),
    ]);

    return NextResponse.json(
      {
        syncScraping: latestRun?.status === "scraping",
        docFetchPending: !!docFetch,
        statusRefreshPending: !!statusRefresh,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("GeM bid extension-poll error:", error);
    return NextResponse.json({ error: error.message || "Poll failed" }, { status: 500, headers: corsHeaders });
  }
}
