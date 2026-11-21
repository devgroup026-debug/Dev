import { normalizeName } from "./normalize";

// Bid item name <-> tag name matching beyond the exact normalized key.
//  1. compactKey: normalized name with every non-alphanumeric (spaces, dots, slashes...) removed, so
//     "PVC Elbow 3/4" == "pvcelbow 3.4" counts as the SAME name (auto-match).
//  2. similarity: 0..1 score used only for "Suggested" hints (never auto-links).

export const compactKey = (s: unknown) => normalizeName(s).replace(/[^a-z0-9]/g, "");

const bigrams = (s: string) => {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
};

// Sorensen-Dice on character bigrams of the compact strings: robust to spacing/dots/word order slips.
function dice(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

const tokens = (s: string) => normalizeName(s).split(" ").filter(Boolean);
const numberTokens = (s: string) => (normalizeName(s).match(/\d+(?:\.\d+)?/g) || []).sort().join(",");

export function similarity(a: string, b: string): number {
  const ca = compactKey(a);
  const cb = compactKey(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let common = 0;
  ta.forEach((t) => tb.has(t) && common++);
  const tokenScore = common / Math.max(ta.size, tb.size, 1);

  let score = Math.max(dice(ca, cb), tokenScore);
  // "500 g" vs "250 g" are different items even if the words look alike
  if (numberTokens(a) !== numberTokens(b)) score *= 0.6;
  return Math.round(score * 1000) / 1000;
}

export const SUGGEST_MIN_SCORE = 0.7;

// ---------------------------------------------------------------------------
// Item-name matching for "Find Pricelist Match" (bid item <-> tag name, and
// bid item <-> Received Purchase itemName). Stricter than similarity() above:
//  - filler words ("of", "for", "with", "size"...) are ignored and simple
//    plurals folded ("gloves" == "glove"), so only words that describe the
//    item count
//  - at least one real (non-number, 3+ letter) word must be shared - a
//    character-bigram overlap alone ("coconut oil" vs "hydraulic oil") is
//    never enough
//  - word overlap is Dice on the word sets, so extra words on either side
//    lower the score
//  - sizes/quantities: different numbers on both sides ("500 g" vs
//    "250 g") cut the score hard; a number on only one side cuts it lightly
// Inputs are prepared once (prepareItemName) so scoring 200 bid items
// against thousands of candidates doesn't re-normalize every string.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "of", "for", "and", "with", "the", "to", "in", "on", "a", "an", "as", "per", "by", "or",
  "size", "type", "item", "items", "make", "brand", "model", "no", "nos", "pcs", "pc",
  "set", "each", "qty", "quality", "good", "best", "new", "isi", "mark", "approx",
]);

const fold = (w: string) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export interface PreparedName {
  compact: string;
  words: Set<string>; // significant words (no numbers, no stopwords), plural-folded
  numbers: string; // sorted, comma-joined numbers
}

export function prepareItemName(s: unknown): PreparedName {
  const norm = normalizeName(s);
  const words = new Set<string>();
  for (const t of norm.split(" ")) {
    if (!t || /^\d+(\.\d+)?$/.test(t) || STOPWORDS.has(t)) continue;
    // keeps mixed codes like "a4" / "20w40" as words, drops lone letters
    if (t.length < 2 || !/[a-z]/.test(t)) continue;
    words.add(fold(t));
  }
  const numbers = (norm.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n))).sort().join(",");
  return { compact: norm.replace(/[^a-z0-9]/g, ""), words, numbers };
}

export function itemSimilarityPrepared(a: PreparedName, b: PreparedName): number {
  if (!a.compact || !b.compact) return 0;
  if (a.compact === b.compact) return 1;

  let common = 0;
  let commonReal = 0;
  a.words.forEach((w) => {
    if (b.words.has(w)) {
      common++;
      if (w.replace(/[^a-z]/g, "").length >= 3) commonReal++;
    }
  });
  if (commonReal === 0) return 0;

  const wordDice = (2 * common) / (a.words.size + b.words.size || 1);
  const charDice = dice(a.compact, b.compact);
  // words carry most of the meaning; the character score only fine-tunes
  // (spelling slips like "suger"/"sugar" still lift it a little)
  let score = 0.75 * wordDice + 0.25 * charDice;

  if (a.numbers && b.numbers) {
    if (a.numbers !== b.numbers) {
      // "A4 Paper" vs "A4 Paper 75 GSM": every number of one side is on the
      // other too - just more detail, not a different size
      const na = a.numbers.split(",");
      const nb = b.numbers.split(",");
      const subset = na.every((n) => nb.includes(n)) || nb.every((n) => na.includes(n));
      score *= subset ? 0.85 : 0.5;
    }
  } else if (a.numbers || b.numbers) {
    score *= 0.9;
  }
  return Math.round(score * 1000) / 1000;
}

export const itemSimilarity = (a: unknown, b: unknown) => itemSimilarityPrepared(prepareItemName(a), prepareItemName(b));

// Thresholds for itemSimilarity (its scale is stricter than similarity()'s).
// Tuned on sample pairs: same item with extra detail ("Engine Oil" vs
// "Engine Oil 20W40 1 Ltr") scores ~0.59+, different items / different
// sizes ("Detergent 500 g" vs "250 g", "Coconut Oil" vs "Hydraulic Brake
// Oil") stay at or below ~0.49.
export const ITEM_SUGGEST_MIN_SCORE = 0.55;
export const PURCHASE_SUGGEST_MIN_SCORE = 0.55;
