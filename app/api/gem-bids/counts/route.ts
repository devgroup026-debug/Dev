import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET - just the numbers behind the GeM Bids tab badges, so the page doesn't
// have to download every bid to know how many are in each tab.
// { all, new_bids, fetched_bid_data, bids_to_fill, submitted_bids, expired_bids, deleted_bids }
// "all" = every live bid (not expired/deleted), i.e. the sum of the four
// workflow sections - same meaning the All Bids badge always had.
export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db(DB_NAME).collection("gem_bids");
    const [live, expired, deleted] = await Promise.all([
      col
        .aggregate([{ $match: { deletedAt: { $exists: false }, expiredAt: { $exists: false } } }, { $group: { _id: "$currentSection", n: { $sum: 1 } } }])
        .toArray(),
      col.countDocuments({ expiredAt: { $exists: true, $ne: null } }),
      col.countDocuments({ deletedAt: { $exists: true, $ne: null } }),
    ]);
    const out: Record<string, number> = { new_bids: 0, fetched_bid_data: 0, bids_to_fill: 0, submitted_bids: 0 };
    let all = 0;
    for (const r of live as any[]) {
      all += r.n;
      if (r._id in out) out[r._id] = r.n;
    }
    return NextResponse.json({ all, ...out, expired_bids: expired, deleted_bids: deleted });
  } catch (error: any) {
    console.error("GeM bids counts error:", error);
    return NextResponse.json({ error: error.message || "Failed to load counts" }, { status: 500 });
  }
}
