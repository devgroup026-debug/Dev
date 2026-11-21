import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getPricelistDb } from "@/lib/pricelist/db";
import { normalizeName } from "@/lib/pricelist/normalize";
import { compactKey, prepareItemName, itemSimilarityPrepared, ITEM_SUGGEST_MIN_SCORE, PURCHASE_SUGGEST_MIN_SCORE } from "@/lib/pricelist/match";

export const runtime = "nodejs";

type Db = Awaited<ReturnType<typeof getPricelistDb>>["db"];

async function loadPricelistRates(db: Db, tagKeys: string[]) {
  const out: Record<string, any[]> = {};
  if (tagKeys.length === 0) return out;
  const links = await db.collection("pricelist_tags").find({ tag_key: { $in: tagKeys } }).toArray();
  if (links.length === 0) return out;
  const items = await db
    .collection("pricelist_items")
    .find({ sku_key: { $in: Array.from(new Set(links.map((l: any) => l.sku_key))) } })
    .project({ search_text: 0, price_history: 0 })
    .toArray();
  const bySku = new Map(items.map((i: any) => [i.sku_key, i]));
  const lists = await db
    .collection("pricelists")
    .find({ _id: { $in: items.map((i: any) => i.pricelist_id) } })
    .project({ uploaded_at: 1 })
    .toArray();
  const uploadedAt = new Map(lists.map((p: any) => [String(p._id), p.uploaded_at]));
  for (const l of links as any[]) {
    const it: any = bySku.get(l.sku_key);
    if (!it) continue;
    (out[l.tag_key] ||= []).push({
      sku_key: it.sku_key,
      rate: it.unit_price_incl_gst,
      brand: it.brand,
      supplier_name: it.supplier_name,
      price: it.price,
      price_qty: it.price_qty,
      discount_pct: it.discount_pct,
      gst_pct: it.gst_pct,
      gst_included: it.gst_included,
      valid_from: it.valid_from,
      price_status: it.price_status,
      is_active: it.is_active,
      uploaded_at: uploadedAt.get(String(it.pricelist_id)) || null,
    });
  }
  return out;
}

async function loadReceivedRates(db: Db, tagKeys: string[]) {
  const out: Record<string, any[]> = {};
  if (tagKeys.length === 0) return out;
  const links = await db.collection("received_purchase_tags").find({ tag_key: { $in: tagKeys } }).toArray();
  if (links.length === 0) return out;
  const client = await clientPromise;
  const latest = await client
    .db()
    .collection("Received purchase")
    .aggregate([
      { $match: { sku: { $in: Array.from(new Set(links.map((l: any) => l.sku))) }, rate: { $gt: 0 } } },
      { $sort: { receivedAt: -1 } },
      { $group: { _id: "$sku", rate: { $first: "$rate" }, vendor: { $first: "$vendor" }, itemName: { $first: "$itemName" }, receivedAt: { $first: "$receivedAt" } } },
    ])
    .toArray();
  const bySku = new Map(latest.map((r: any) => [r._id, r]));
  for (const l of links as any[]) {
    const r: any = bySku.get(l.sku);
    if (!r) continue;
    (out[l.tag_key] ||= []).push({ sku: l.sku, rate: r.rate, vendor: r.vendor || "", itemName: r.itemName || "", receivedAt: r.receivedAt || null });
  }
  return out;
}

const sortPricelist = (list: any[]) =>
  list.sort((a, b) => {
    // active+priced first, then cheapest; inactive/on-request sink to the bottom
    const rank = (x: any) => (x.is_active && x.rate !== null ? 0 : x.is_active ? 1 : 2);
    return rank(a) - rank(b) || (a.rate ?? 0) - (b.rate ?? 0);
  });

// Best Received Purchase row per bid item title, by itemSimilarity (title
// only - a BOQ specification is free text that never appears in a
// purchase's itemName). Rate-0 rows (received but never priced) are
// skipped - they used to show up as a useless "Purchased: 0".
// Strict on purpose: a Received Purchase row is only offered when it is the
// SAME item as the bid line, judged on title + specification together -
//  1) every word of the bid title is in the purchase name ("Spark plug
//     spanner" must not take the rate of a plain "SPARK PLUG"), and
//  2) every word / number of the purchase name appears in the bid's title or
//     specification (a purchase "... 14mm" must agree with the spec).
// Within those, the most similar name wins.
async function loadPurchaseMatches(items: { title: string; spec: string }[]) {
  const out: Record<string, { rate: number; vendor: string; itemName: string; receivedAt: any; score: number }> = {};
  if (items.length === 0) return out;
  const client = await clientPromise;
  const docs = await client
    .db()
    .collection("Received purchase")
    .find({ itemName: { $exists: true, $ne: "" }, rate: { $gt: 0 } }, { projection: { itemName: 1, rate: 1, vendor: 1, receivedAt: 1 } })
    .sort({ receivedAt: -1 })
    .limit(5000)
    .toArray();
  // newest first, so the first row per distinct item name is its latest rate
  const byName = new Map<string, any>();
  for (const d of docs as any[]) {
    const k = normalizeName(d.itemName);
    if (k && !byName.has(k)) byName.set(k, d);
  }
  const cands = Array.from(byName.values()).map((d) => ({ d, p: prepareItemName(d.itemName) }));
  for (const { title, spec } of items) {
    const full = prepareItemName([title, spec].filter(Boolean).join(" "));
    const t = prepareItemName(title);
    const fullNums = full.numbers ? full.numbers.split(",") : [];
    let best: any = null;
    let bestScore = 0;
    for (const c of cands) {
      let ok = true;
      t.words.forEach((w) => {
        if (!c.p.words.has(w)) ok = false;
      });
      if (!ok) continue;
      c.p.words.forEach((w) => {
        if (!full.words.has(w)) ok = false;
      });
      if (!ok) continue;
      if (c.p.numbers && !c.p.numbers.split(",").every((n) => fullNums.includes(n))) continue;
      const s = itemSimilarityPrepared(full, c.p);
      if (s > bestScore || !best) {
        bestScore = s;
        best = c.d;
      }
    }
    if (best) {
      out[normalizeName([title, spec].filter(Boolean).join(" "))] = { rate: best.rate, vendor: best.vendor || "", itemName: best.itemName || "", receivedAt: best.receivedAt || null, score: bestScore };
    }
  }
  return out;
}

// POST { names: [], suggest?: boolean, purchaseNames?: [] } -> { rates, received, suggestions, purchase },
// keyed by normalizeName(name).
//  rates       = supplier pricelist rates of items tagged with a matching name
//  received    = latest positive Received Purchase rate per tagged sku (what we actually paid)
//  -- only with suggest: true (the Bid Rate page's "Find Pricelist Match" button; never automatic,
//     since fuzzy-scoring every bid item against every tag / purchase row is the expensive part) --
//  suggestions = near-misses (itemSimilarity >= ITEM_SUGGEST_MIN_SCORE) for names with no match in that
//                source; shown as hints only, never linked automatically
//  purchase    = best fuzzy Received Purchase match per purchaseNames entry (bid item title)
// "Matching" ignores case, spaces and punctuation (compactKey), so "PVC Elbow 3/4" == "pvcelbow 3.4".
export async function POST(req: Request) {
  try {
    const { names, suggest, purchaseItems, titles: titlesIn } = await req.json();
    const titles: Record<string, string> = titlesIn && typeof titlesIn === "object" ? titlesIn : {};
    if (!Array.isArray(names)) return NextResponse.json({ error: "names must be an array" }, { status: 400 });
    const keys = Array.from(new Set(names.map(normalizeName).filter(Boolean)));
    if (keys.length === 0) return NextResponse.json({ rates: {}, received: {}, suggestions: {}, purchase: {} });
    const wantSuggest = suggest === true;

    const { db } = await getPricelistDb();
    const [plTags, recTags] = await Promise.all([
      db.collection("pricelist_tags").aggregate([{ $group: { _id: "$tag_key", name: { $first: "$tag_name" } } }]).toArray(),
      db.collection("received_purchase_tags").aggregate([{ $group: { _id: "$tag_key", name: { $first: "$tag_name" } } }]).toArray(),
    ]);
    type TagIdx = { key: string; name: string; compact: string; prep: ReturnType<typeof prepareItemName> | null };
    const plIdx: TagIdx[] = plTags.map((t: any) => ({ key: t._id, name: t.name, compact: compactKey(t._id), prep: null }));
    const recIdx: TagIdx[] = recTags.map((t: any) => ({ key: t._id, name: t.name, compact: compactKey(t._id), prep: null }));
    // prepared once per tag, only when fuzzy suggestions are actually asked for
    if (wantSuggest) for (const t of [...plIdx, ...recIdx]) t.prep = prepareItemName(t.name || t.key);

    // 1) same name once spaces/punctuation/case are ignored -> real match
    const plMatch = new Map<string, string[]>();
    const recMatch = new Map<string, string[]>();
    const plSuggest = new Map<string, { key: string; name: string; score: number }[]>();
    const recSuggest = new Map<string, { key: string; name: string; score: number }[]>();
    const resolve = (k: string, idx: typeof plIdx, match: Map<string, string[]>, suggest: typeof plSuggest) => {
      const c = compactKey(k);
      const same = idx.filter((t) => t.compact === c).map((t) => t.key);
      if (same.length) return void match.set(k, same);
      if (!wantSuggest) return;
      // 2) otherwise the closest tags above the threshold become suggestions
      const q = prepareItemName(k);
      // Tags saved from a bid are "title + specification"; a later bid often
      // words the spec differently, which sinks the full-name score. If the
      // bid item's title alone is the start of a tag (or vice versa) it is
      // still worth a hint.
      const tc = compactKey(normalizeName(titles[k] || ""));
      const near = idx
        .map((t) => {
          let score = itemSimilarityPrepared(q, t.prep!);
          if (tc.length >= 8 && (t.compact.startsWith(tc) || tc.startsWith(t.compact))) score = Math.max(score, ITEM_SUGGEST_MIN_SCORE + 0.05);
          return { key: t.key, name: t.name, score };
        })
        .filter((t) => t.score >= ITEM_SUGGEST_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      if (near.length) suggest.set(k, near);
    };
    for (const k of keys) {
      resolve(k, plIdx, plMatch, plSuggest);
      resolve(k, recIdx, recMatch, recSuggest);
    }

    const plKeysNeeded = Array.from(new Set([...Array.from(plMatch.values()).flat(), ...Array.from(plSuggest.values()).flat().map((s) => s.key)]));
    const recKeysNeeded = Array.from(new Set([...Array.from(recMatch.values()).flat(), ...Array.from(recSuggest.values()).flat().map((s) => s.key)]));
    const purchaseList: { title: string; spec: string }[] = [];
    if (wantSuggest && Array.isArray(purchaseItems)) {
      const seen = new Set<string>();
      for (const p of purchaseItems) {
        const title = String(p?.title || "").trim();
        const spec = String(p?.spec || "").trim();
        const k = normalizeName(`${title} ${spec}`);
        if (title && !seen.has(k)) {
          seen.add(k);
          purchaseList.push({ title, spec });
        }
      }
    }
    const [plRates, recRates, purchase] = await Promise.all([
      loadPricelistRates(db, plKeysNeeded),
      loadReceivedRates(db, recKeysNeeded),
      loadPurchaseMatches(purchaseList),
    ]);

    const rates: Record<string, any[]> = {};
    plMatch.forEach((tagKeys, k) => {
      const list = sortPricelist(tagKeys.flatMap((tk) => plRates[tk] || []));
      if (list.length) rates[k] = list;
    });
    const received: Record<string, any[]> = {};
    recMatch.forEach((tagKeys, k) => {
      const list = tagKeys.flatMap((tk) => recRates[tk] || []).sort((a, b) => a.rate - b.rate);
      if (list.length) received[k] = list;
    });

    const suggestions: Record<string, any[]> = {};
    plSuggest.forEach((near, k) => {
      for (const n of near) {
        const best = sortPricelist([...(plRates[n.key] || [])])[0];
        if (best && best.is_active && best.rate !== null) (suggestions[k] ||= []).push({ source: "pricelist", tag_name: n.name, score: n.score, rate: best.rate, label: best.brand || best.supplier_name });
      }
    });
    recSuggest.forEach((near, k) => {
      for (const n of near) {
        const best = [...(recRates[n.key] || [])].sort((a, b) => a.rate - b.rate)[0];
        if (best) (suggestions[k] ||= []).push({ source: "received", tag_name: n.name, score: n.score, rate: best.rate, label: best.vendor });
      }
    });
    for (const k of Object.keys(suggestions)) suggestions[k].sort((a, b) => b.score - a.score);

    return NextResponse.json({ rates, received, suggestions, purchase });
  } catch (error: any) {
    console.error("Pricelist rates-for-names error:", error);
    return NextResponse.json({ error: error.message || "Failed to load rates" }, { status: 500 });
  }
}
