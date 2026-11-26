import { NextResponse } from "next/server";
import CashAccount from "@/models/CashAccount";
import CashbookEntry from "@/models/CashbookEntry";
import { CbError, cbHandler, computeBalances, ensureDefaults, getCbActor, isDateStr, requirePerm, serializeEntry, todayIST } from "@/lib/cashbook/server";

const MAX_DAYS = 400;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/**
 * Reports (all count APPROVED entries only):
 *  type=statement  date-range cashbook; optional `account` => account-wise statement with running balance
 *  type=category   category-wise IN / OUT summary
 *  type=staff      staff advance statement; no `staff` => summary of all staff, with `staff` => day-wise rows
 */
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookReports");
  await ensureDefaults();

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") || "statement";
  const to = isDateStr(sp.get("to")) ? (sp.get("to") as string) : todayIST();
  const from = isDateStr(sp.get("from")) ? (sp.get("from") as string) : to.slice(0, 8) + "01";
  if (from > to) throw new CbError(400, "From date To date se baad ki nahi ho sakti");
  if (daysBetween(from, to) > MAX_DAYS) throw new CbError(400, `Ek baar mein max ${MAX_DAYS} din ki report le sakte ho`);

  const base: any = { status: "APPROVED", date: { $gte: from, $lte: to } };

  // ------------------------------------------------------------ category summary
  if (type === "category") {
    const match: any = { ...base, type: { $in: ["NORMAL", "ORDER_PAYMENT_CASH"] } };
    if (sp.get("account")) match.account = sp.get("account");
    const rows: any[] = await CashbookEntry.aggregate([
      { $match: match },
      { $group: { _id: { name: "$categoryName", direction: "$direction" }, total: { $sum: "$amountPaise" }, count: { $sum: 1 } } },
    ]);
    const map = new Map<string, { category: string; inPaise: number; outPaise: number; count: number }>();
    for (const r of rows) {
      const k = r._id.name || "(No category)";
      const cur = map.get(k) || { category: k, inPaise: 0, outPaise: 0, count: 0 };
      if (r._id.direction === "IN") cur.inPaise += r.total;
      else cur.outPaise += r.total;
      cur.count += r.count;
      map.set(k, cur);
    }
    const list = [...map.values()].sort((a, b) => b.inPaise + b.outPaise - (a.inPaise + a.outPaise));
    return NextResponse.json({
      type, from, to,
      rows: list,
      totalIn: list.reduce((s, r) => s + r.inPaise, 0),
      totalOut: list.reduce((s, r) => s + r.outPaise, 0),
    });
  }

  // ------------------------------------------------------------ staff advance
  if (type === "staff") {
    const staffFilter = (sp.get("staff") || "").trim();
    const opening = (await computeBalances(from)).perStaff;
    const entries: any[] = await CashbookEntry.find({
      ...base,
      $or: [{ type: { $in: ["ADVANCE_TOPUP", "ADVANCE_RETURN"] } }, { paidFrom: "STAFF_ADVANCE", direction: "OUT" }],
      ...(staffFilter ? { staff: staffFilter } : {}),
    })
      .sort({ date: 1, createdAt: 1 })
      .lean();

    const delta = (e: any) => (e.type === "ADVANCE_TOPUP" ? e.amountPaise : -e.amountPaise);

    if (staffFilter) {
      let run = opening[staffFilter] || 0;
      const openingPaise = run;
      const rows = entries.map((e) => {
        run += delta(e);
        return { ...serializeEntry(e), runningPaise: run };
      });
      return NextResponse.json({
        type, from, to, staff: staffFilter,
        openingPaise,
        closingPaise: run,
        topupPaise: entries.filter((e) => e.type === "ADVANCE_TOPUP").reduce((s, e) => s + e.amountPaise, 0),
        returnPaise: entries.filter((e) => e.type === "ADVANCE_RETURN").reduce((s, e) => s + e.amountPaise, 0),
        spentPaise: entries.filter((e) => e.type === "NORMAL").reduce((s, e) => s + e.amountPaise, 0),
        rows,
      });
    }

    const per = new Map<string, { staff: string; openingPaise: number; topupPaise: number; returnPaise: number; spentPaise: number; closingPaise: number }>();
    const get = (s: string) => {
      let r = per.get(s);
      if (!r) per.set(s, (r = { staff: s, openingPaise: opening[s] || 0, topupPaise: 0, returnPaise: 0, spentPaise: 0, closingPaise: 0 }));
      return r;
    };
    for (const s of Object.keys(opening)) if (opening[s] !== 0) get(s);
    for (const e of entries) {
      const r = get(e.staff);
      if (e.type === "ADVANCE_TOPUP") r.topupPaise += e.amountPaise;
      else if (e.type === "ADVANCE_RETURN") r.returnPaise += e.amountPaise;
      else r.spentPaise += e.amountPaise;
    }
    const list = [...per.values()].map((r) => ({ ...r, closingPaise: r.openingPaise + r.topupPaise - r.returnPaise - r.spentPaise }));
    list.sort((a, b) => a.staff.localeCompare(b.staff));
    return NextResponse.json({ type, from, to, rows: list });
  }

  // ------------------------------------------------------------ statement (date-range / account-wise)
  const accountId = (sp.get("account") || "").trim();
  const accs: any[] = await CashAccount.find({}).lean();
  const accName = new Map(accs.map((a) => [String(a._id), a.name as string]));
  if (accountId && !accName.has(accountId)) throw new CbError(404, "Account nahi mila");
  const scoped = accs.filter((a) => !accountId || String(a._id) === accountId);

  const bal = await computeBalances(from);
  const openingPaise = scoped.reduce((s, a) => s + (bal.accounts[String(a._id)] || 0), 0);

  // entries that touch an account (staff-advance spends have no account and are not part of any statement)
  const entries: any[] = await CashbookEntry.find({ ...base, account: accountId ? accountId : { $ne: null } })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  type Row = ReturnType<typeof serializeEntry> & { accountName: string; runningPaise: number; opening?: boolean };
  const rows: Row[] = [];
  // accounts created inside the range start with their opening balance on that date
  const lateOpenings = scoped
    .filter((a) => a.openingDate > from && a.openingDate <= to && (a.openingPaise || 0) !== 0)
    .map((a) => ({ date: a.openingDate as string, name: a.name as string, paise: a.openingPaise as number, id: String(a._id) }));

  let run = openingPaise;
  let totalIn = 0;
  let totalOut = 0;
  const merged: { date: string; kind: "E" | "O"; e?: any; o?: (typeof lateOpenings)[number] }[] = [
    ...lateOpenings.map((o) => ({ date: o.date, kind: "O" as const, o })),
    ...entries.map((e) => ({ date: e.date as string, kind: "E" as const, e })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === "O" ? -1 : 1) : a.date < b.date ? -1 : 1));

  for (const m of merged) {
    if (m.kind === "O" && m.o) {
      run += m.o.paise;
      rows.push({
        id: "opening-" + m.o.id, date: m.o.date, createdAt: m.o.date, direction: "IN", type: "OPENING", amountPaise: m.o.paise, mode: "", accountId: m.o.id,
        paidFrom: "ACCOUNT", staff: "", categoryId: null, categoryName: "Opening balance", particulars: `${m.o.name} — opening balance`, remark: "", hasAttachment: false,
        institute: "", allocations: [], onAccountPaise: 0, onAccountAllocatedPaise: 0, deductionPaise: 0, deductionType: null, status: "APPROVED", rejectReason: "",
        enteredBy: "", approvedBy: "", approvedAt: null, audit: [], accountName: m.o.name, runningPaise: run, opening: true,
      } as Row);
      continue;
    }
    const e = m.e;
    run += e.direction === "IN" ? e.amountPaise : -e.amountPaise;
    // Total In/Out = real money movement; top-up / return between accounts and staff wallets are shown but not totalled.
    if (e.type === "NORMAL" || e.type === "ORDER_PAYMENT_CASH") {
      if (e.direction === "IN") totalIn += e.amountPaise;
      else totalOut += e.amountPaise;
    }
    rows.push({ ...serializeEntry(e), accountName: accName.get(String(e.account)) || "", runningPaise: run });
  }

  return NextResponse.json({
    type: "statement", from, to,
    account: accountId ? { id: accountId, name: accName.get(accountId) } : null,
    openingPaise, closingPaise: run, totalIn, totalOut, rows,
  });
});
