import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CashAccount from "@/models/CashAccount";
import CashbookEntry from "@/models/CashbookEntry";
import { addDays, CbError, cbHandler, computeBalances, getCbActor, isDateStr, requirePerm, serializeEntry, toPaise, todayIST } from "@/lib/cashbook/server";

const HARDCODED_ADMINS = ["admin", "chintan", "hitesh"];

async function staffExists(name: string) {
  if (HARDCODED_ADMINS.includes(name.toLowerCase())) return true;
  const db = mongoose.connection.db;
  return !!(db && (await db.collection("users").findOne({ username: name }, { projection: { _id: 1 } })));
}

// Signed effect of an entry on the staff wallet.
const walletDelta = (e: any) => (e.type === "ADVANCE_TOPUP" ? e.amountPaise : -e.amountPaise);
const wallet = (staff: string) => ({
  staff,
  $or: [{ type: { $in: ["ADVANCE_TOPUP", "ADVANCE_RETURN"] } }, { paidFrom: "STAFF_ADVANCE", direction: "OUT" }],
});

/**
 * One staff member's advance ledger: wallet balance, pending expenses, and a
 * day-wise ledger where each day opens with the previous day's closing balance.
 * Staff may read only their own; reading anybody else's needs cashbookAdvance.
 */
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView");
  const sp = new URL(req.url).searchParams;
  const staff = (sp.get("staff") || actor.username).trim();
  if (staff !== actor.username) requirePerm(actor, "cashbookAdvance");

  const approved: any[] = await CashbookEntry.find({ ...wallet(staff), status: "APPROVED" }).sort({ date: 1, createdAt: 1 }).lean();
  const pending: any[] = await CashbookEntry.find({ ...wallet(staff), status: "PENDING" }).sort({ createdAt: 1 }).lean();

  const balance = approved.reduce((s, e) => s + walletDelta(e), 0);
  const pendingTotal = pending.reduce((s, e) => s + e.amountPaise, 0); // pending items are all expenses

  const byDate = new Map<string, any[]>();
  for (const e of approved) byDate.set(e.date, [...(byDate.get(e.date) || []), e]);
  let running = 0;
  const days = [...byDate.entries()].map(([date, entries]) => {
    const carryForward = running;
    for (const e of entries) running += walletDelta(e);
    return { date, carryForward, closing: running, entries: entries.map((e) => ({ ...serializeEntry(e), delta: walletDelta(e) })) };
  });
  days.reverse(); // newest first

  return NextResponse.json({
    staff,
    balancePaise: balance, // negative = staff ko dena baaki
    pendingPaise: pendingTotal,
    balanceAfterPendingPaise: balance - pendingTotal,
    pending: pending.map(serializeEntry),
    days,
  });
});

/** Owner action: give money to staff (TOPUP) or take it back (RETURN). Always approved immediately. */
export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookAdvance");
  const b = await req.json();

  const kind = b.kind;
  if (kind !== "TOPUP" && kind !== "RETURN") throw new CbError(400, "Top-up ya Return chuno");
  const staff = String(b.staff || "").trim();
  if (!staff || !(await staffExists(staff))) throw new CbError(400, "Staff chuno");
  const amountPaise = toPaise(b.amount);

  const mode = b.mode;
  if (!["CASH", "BANK", "UPI"].includes(mode)) throw new CbError(400, "Payment mode chuno");
  const account: any = await CashAccount.findById(b.accountId);
  if (!account || !account.active) throw new CbError(400, "Account chuno");
  if (account.type !== (mode === "CASH" ? "CASH" : "BANK")) throw new CbError(400, mode === "CASH" ? "Cash ke liye Cash account chuno" : "Bank/UPI ke liye Bank account chuno");

  const date = b.date || todayIST();
  if (!isDateStr(date) || date > todayIST()) throw new CbError(400, "Date sahi nahi hai");

  if (kind === "RETURN") {
    const bal = (await computeBalances(addDays(todayIST(), 1))).perStaff[staff] || 0;
    if (amountPaise > bal) throw new CbError(400, "Staff ke paas itna advance nahi hai (wallet ₹" + bal / 100 + ")");
  }

  const now = new Date();
  const doc = await CashbookEntry.create({
    date,
    direction: kind === "TOPUP" ? "OUT" : "IN", // direction is from the point of view of the account
    type: kind === "TOPUP" ? "ADVANCE_TOPUP" : "ADVANCE_RETURN",
    amountPaise,
    mode,
    account: account._id,
    paidFrom: "ACCOUNT",
    staff,
    categoryName: "Staff advance",
    particulars: kind === "TOPUP" ? `Advance diya: ${staff}` : `Advance wapas liya: ${staff}`,
    remark: String(b.remark || "").trim(),
    status: "APPROVED",
    enteredBy: actor.username,
    approvedBy: actor.username,
    approvedAt: now,
    audit: [{ action: "CREATED", by: actor.username, at: now }, { action: "APPROVED", by: actor.username, at: now, note: "owner transfer" }],
  });
  return NextResponse.json(serializeEntry(doc.toObject()), { status: 201 });
});
