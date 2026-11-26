import { NextResponse } from "next/server";
import CashAccount from "@/models/CashAccount";
import CashbookEntry from "@/models/CashbookEntry";
import { addDays, Balances, cbHandler, computeBalances, ensureDefaults, getCbActor, isDateStr, requirePerm, serializeEntry, todayIST } from "@/lib/cashbook/server";

function breakup(accs: any[], bal: Balances) {
  const cash = accs.filter((a) => a.type === "CASH").reduce((s, a) => s + (bal.accounts[String(a._id)] || 0), 0);
  const banks = accs
    .filter((a) => a.type === "BANK")
    .map((a) => ({ id: String(a._id), name: a.name, paise: bal.accounts[String(a._id)] || 0, active: a.active }))
    .filter((b) => b.active || b.paise !== 0);
  const total = cash + banks.reduce((s, b) => s + b.paise, 0) + bal.staffTotal;
  return { cash, banks, staff: bal.staffTotal, total };
}

/**
 * Day view. Cards + breakup only for people allowed to see everything;
 * others get just their own entries.
 */
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView");
  await ensureDefaults();
  const sp = new URL(req.url).searchParams;
  const date = isDateStr(sp.get("date")) ? (sp.get("date") as string) : todayIST();
  const seeAll = actor.has("cashbookApprove") || actor.has("cashbookAllEntries");

  const filter: any = { date, status: { $ne: "DELETED" } };
  if (!seeAll) filter.enteredBy = actor.username;
  const rows = await CashbookEntry.find(filter).sort({ createdAt: 1 }).lean();

  const out: any = { date, seeAll, entries: rows.map(serializeEntry) };

  if (seeAll) {
    const accs: any[] = await CashAccount.find({}).lean();
    const [open, close] = await Promise.all([computeBalances(date), computeBalances(addDays(date, 1))]);
    // Total In/Out: approved real money movement only (transfers = top-up / return are excluded).
    const sums: any[] = await CashbookEntry.aggregate([
      { $match: { date, status: "APPROVED", type: { $in: ["NORMAL", "ORDER_PAYMENT_CASH"] } } },
      { $group: { _id: "$direction", sum: { $sum: "$amountPaise" } } },
    ]);
    const totalIn = sums.find((s) => s._id === "IN")?.sum || 0;
    const totalOut = sums.find((s) => s._id === "OUT")?.sum || 0;
    out.cards = { opening: breakup(accs, open), closing: breakup(accs, close), totalIn, totalOut };
  }

  const pending: any[] = await CashbookEntry.find({ status: "PENDING", ...(actor.has("cashbookApprove") ? {} : { enteredBy: actor.username }) })
    .select("amountPaise direction")
    .lean();
  out.pending = { count: pending.length, totalPaise: pending.reduce((s, p) => s + p.amountPaise, 0), canApprove: actor.has("cashbookApprove") };
  return NextResponse.json(out);
});
