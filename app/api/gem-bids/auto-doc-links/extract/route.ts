import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { extractSpecForBid } from "@/lib/gemBids/autoDocLinksJob";

const DB_NAME = "dev_oms_db";

// Full multi-page PDF parse + an external fetch + an R2 upload - same
// timeout headroom as the parent auto-doc-links route.
export const maxDuration = 60;

// POST { bidId } - Document Maker's "Load Spec from Bid Doc" button. Reads
// the bid's already-fetched Bid Document, finds the embedded Specification
// Document link and stores that file. This used to run automatically in the
// background for every bid (see autoDocLinksJob.ts); it's on demand now to
// save Vercel CPU on bids nobody ends up working on.
export async function POST(req: Request) {
  try {
    const { bidId } = await req.json();
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await extractSpecForBid(db, new ObjectId(bidId));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GeM bid spec extract error:", error);
    return NextResponse.json({ error: error.message || "Spec extraction failed" }, { status: 500 });
  }
}
