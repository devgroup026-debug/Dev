import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET - the distinct values behind the table's dropdown filters (city, Bid To
// RA, RA, Type of Bid, Evaluation), so the All Bids tab can fill them without
// having any bids loaded.
export async function GET() {
  try {
    const client = await clientPromise;
    const col = client.db(DB_NAME).collection("gem_bids");
    const fields = ["consigneeCity", "bidToRaEnabled", "raQualificationRule", "typeOfBid", "evaluationMethod"];
    const out: Record<string, string[]> = {};
    await Promise.all(
      fields.map(async (f) => {
        const vals = await col.distinct(f);
        out[f] = (vals as any[]).filter((v) => typeof v === "string" && v).map(String).sort();
      })
    );
    return NextResponse.json(out);
  } catch (error: any) {
    console.error("GeM bids filter-options error:", error);
    return NextResponse.json({ error: error.message || "Failed to load filter options" }, { status: 500 });
  }
}
