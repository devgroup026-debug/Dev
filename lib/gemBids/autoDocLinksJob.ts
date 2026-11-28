import { getFileFromR2, uploadFileToR2 } from "@/lib/cloudflareR2";
import { extractOrderItemLinks } from "@/lib/documentMaker/linkExtractEngine";

const SETTINGS_COLLECTION = "gem_bid_settings";
const LAST_RUN_KEY = "lastAutoDocLinksJobDate";
// Was 2 minutes with 5 bids per run - the PDF parse below (pdfjs-dist +
// @napi-rs/canvas) is the single most CPU-expensive thing this app does,
// and that combination regularly blew Vercel's Fluid Active CPU quota.
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const ENQUEUE_BATCH_SIZE = 10;

export interface AutoDocLinksJobResult {
  ran: boolean;
  reason?: string;
  queuedForFetch?: number;
}

async function fetchPublicDoc(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { buffer, contentType: resp.headers.get("content-type") || "application/octet-stream" };
  } catch {
    return null;
  }
}

/**
 * Self-throttled, site-visit-triggered (see app/layout.tsx), same pattern
 * as runExpireBidsJobIfDue. Automatic for every Bids to Fill/Submitted
 * Bids bid. Two steps each run:
 *
 * 1. Queue a Bid Document fetch (docFetch, same mechanism Generate ATC
 *    already uses) for any bid that doesn't have one yet - GeM blocks
 *    non-browser requests for the Bid Document itself, so this can only be
 *    queued here, not fetched directly; the extension's existing
 *    background worker (already polling for pending docFetch jobs) picks
 *    it up. A bid that already has its Bid Document (a prior sync already
 *    queued and fetched it, or Generate ATC did) is never re-queued -
 *    "already has it" is exactly "has bidLinkDoc.fileKey", so this is
 *    naturally a no-op for every bid past its first sync.
 * 2. For any such bid whose Bid Document has since been fetched but not
 *    yet checked for an embedded Specification Document link, reads it
 *    (extractOrderItemLinks) and fetches+stores that file directly -
 *    mkp.gem.gov.in serves it with no GeM login at all (confirmed: a plain
 *    curl, no cookies, returns the real file), so this needs no extension
 *    round trip of its own. A bid that already has one set (a manual
 *    upload, or an auto-fetch from an earlier run) is never overwritten.
 *    Marked checked either way so a bid with no such link isn't re-parsed
 *    forever.
 *
 * The BOQ Detail Document (the rates table itself) is deliberately NOT
 * auto-fetched here anymore, by request - it rarely actually came through
 * this way in practice, so "BOQ Rates" now only ever gets populated by the
 * existing manual "Upload BOQ File" button (document-maker's Rate tab) or,
 * for a Regular Bid, by typing items in directly. The Specification link
 * alone is worth auto-fetching since that one reliably works.
 */
export async function runAutoDocLinksJobIfDue(db: any): Promise<AutoDocLinksJobResult> {
  const now = new Date();
  const settingsCollection = db.collection(SETTINGS_COLLECTION);

  // Claim this run atomically BEFORE doing any work. ranAt used to be
  // written only at the very end - so a run killed by maxDuration never
  // recorded it, and every following page load (every user, every tab)
  // started yet another 60s PDF-parsing run, several in parallel, on the
  // same bids. The conditional updateOne below only matches (modifiedCount
  // 1) for exactly one caller once the interval has passed.
  await settingsCollection.updateOne(
    { key: LAST_RUN_KEY },
    { $setOnInsert: { key: LAST_RUN_KEY, ranAt: new Date(0) } },
    { upsert: true }
  );
  const claim = await settingsCollection.updateOne(
    {
      key: LAST_RUN_KEY,
      $or: [{ ranAt: { $exists: false } }, { ranAt: { $lt: new Date(now.getTime() - MIN_INTERVAL_MS) } }],
    },
    { $set: { ranAt: now } }
  );
  if (claim.modifiedCount === 0) {
    return { ran: false, reason: "checked recently" };
  }

  const bidsCollection = db.collection("gem_bids");
  const sections = ["bids_to_fill", "submitted_bids"];

  const toQueue = await bidsCollection
    .find(
      {
        currentSection: { $in: sections },
        "bidLinkDoc.fileKey": { $exists: false },
        "docFetch.status": { $nin: ["pending", "fetching"] },
      },
      { projection: { _id: 1 } }
    )
    .limit(ENQUEUE_BATCH_SIZE)
    .toArray();
  let queuedForFetch = 0;
  if (toQueue.length > 0) {
    const res = await bidsCollection.updateMany(
      { _id: { $in: toQueue.map((b: any) => b._id) } },
      { $set: { docFetch: { status: "pending", requestedAt: now, finishedAt: null, error: null } } }
    );
    queuedForFetch = res.modifiedCount || 0;
  }

  // Step 2 (parsing the Bid Document for its Specification link) used to
  // run here too, on 2 bids every run - the PDF parse is the single most
  // CPU-expensive thing this app does, and it was spent on every bid that
  // reached Bids to Fill/Submitted Bids, most of which expire unworked.
  // It now runs only on demand, per bid, from Document Maker's "Load Spec
  // from Bid Doc" button (POST /api/gem-bids/auto-doc-links/extract ->
  // extractSpecForBid below). Queueing the Bid Document itself (step 1,
  // DB-only, no CPU to speak of) stays automatic so that button is fast.
  return { ran: true, queuedForFetch };
}

export interface ExtractSpecResult {
  ok: boolean;
  found: boolean;
  reason?: "no_bid_document" | "already_has_spec" | "no_spec_link" | "spec_fetch_failed";
}

/**
 * On-demand (button-triggered) version of the old automatic step 2: reads
 * one bid's already-fetched Bid Document, pulls the embedded Specification
 * Document link out of it and stores that file in R2. Never overwrites a
 * Specification Document that's already there. R2/parse errors throw to
 * the caller so the button can show them.
 */
export async function extractSpecForBid(db: any, bidId: any): Promise<ExtractSpecResult> {
  const bidsCollection = db.collection("gem_bids");
  const bid = await bidsCollection.findOne(
    { _id: bidId },
    { projection: { _id: 1, bidLinkDoc: 1, specificationDoc: 1 } }
  );
  if (!bid?.bidLinkDoc?.fileKey) return { ok: false, found: false, reason: "no_bid_document" };
  if (bid.specificationDoc?.fileKey) return { ok: true, found: true, reason: "already_has_spec" };

  const now = new Date();
  const bidDocBytes = await getFileFromR2(bid.bidLinkDoc.fileKey);
  const links = await extractOrderItemLinks(bidDocBytes);

  if (!links.specificationUrl) {
    await bidsCollection.updateOne({ _id: bid._id }, { $set: { autoDocLinksCheckedAt: now, autoDocLinksFound: false } });
    return { ok: true, found: false, reason: "no_spec_link" };
  }

  const fetched = await fetchPublicDoc(links.specificationUrl);
  if (!fetched) return { ok: false, found: false, reason: "spec_fetch_failed" };

  const key = `bids/${bid._id.toString()}/source-docs/spec.pdf`;
  await uploadFileToR2(fetched.buffer, key, "application/pdf");
  await bidsCollection.updateOne(
    { _id: bid._id },
    {
      $set: {
        "specificationDoc.fileKey": key,
        "specificationDoc.fetchedAt": now,
        autoDocLinksCheckedAt: now,
        autoDocLinksFound: true,
      },
    }
  );
  return { ok: true, found: true };
}
