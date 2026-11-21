import type { Db, ObjectId } from "mongodb";

// gem_bids.firmRates: the final per-item rates + grand total each firm is
// quoting on a bid, keyed by that firm's company _id. Rebuilt (never edited
// by hand) from three inputs, so it can't drift from them:
//   - the bid's saved Rate column (boqRates = L1)
//   - boqVariantPartyPercents (BOQ Rate Variants tool: firm -> % over L1)
//   - the bid's selected firm(s)
// A firm that was assigned a variant gets L1 bumped by its %, exactly like
// the generated variant file. If no variant covers the FIRST selected firm
// it gets plain L1 ("auto"), so the selected firm always has a final rate
// saved under its name even when no variant was ever generated. Other
// selected firms without a variant get nothing (by request).
export type FirmRates = Record<
  string,
  {
    source: "variant" | "auto";
    percent: number;
    rates: { itemNumber: string; itemTitle: string; quantity: string; rate: number; total: number }[];
    grandTotal: number;
    savedAt: Date;
  }
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildFirm(boqRates: any[], percent: number, source: "variant" | "auto", now: Date) {
  const rates = boqRates
    .filter((r) => parseFloat(r.rate) > 0)
    .map((r) => {
      const qty = parseFloat(r.quantity) || 0;
      const rate = round2(parseFloat(r.rate) * (1 + percent / 100));
      return { itemNumber: String(r.itemNumber || ""), itemTitle: String(r.itemTitle || ""), quantity: String(r.quantity || ""), rate, total: round2(qty * rate) };
    });
  return { source, percent, rates, grandTotal: round2(rates.reduce((s, r) => s + r.total, 0)), savedAt: now };
}

export function computeFirmRates(bid: any, overrides?: { items?: any[]; percents?: Record<string, number> }): FirmRates {
  const now = new Date();
  const boqRates: any[] = overrides?.items ?? bid.boqRates ?? [];
  const percents: Record<string, number> = overrides?.percents ?? bid.boqVariantPartyPercents ?? {};
  const out: FirmRates = {};
  if (!boqRates.some((r) => parseFloat(r.rate) > 0)) return out;
  for (const [pid, pct] of Object.entries(percents)) out[pid] = buildFirm(boqRates, Number(pct) || 0, "variant", now);
  const partyIds: string[] = bid.selectedPartyIds?.length ? bid.selectedPartyIds : bid.selectedPartyId ? [bid.selectedPartyId] : [];
  const first = partyIds[0];
  if (first && !out[first]) out[first] = buildFirm(boqRates, 0, "auto", now);
  return out;
}

// Reloads the bid, rebuilds firmRates and saves it. Returns the firm ids saved.
export async function syncFirmRates(
  db: Db,
  filter: { _id: ObjectId } | { bidNo: string },
  overrides?: { items?: any[]; percents?: Record<string, number> }
): Promise<string[]> {
  const col = db.collection("gem_bids");
  const bid = await col.findOne(filter);
  if (!bid) return [];
  const firmRates = computeFirmRates(bid, overrides);
  await col.updateOne({ _id: bid._id }, { $set: { firmRates, firmRatesUpdatedAt: new Date() } });
  return Object.keys(firmRates);
}
