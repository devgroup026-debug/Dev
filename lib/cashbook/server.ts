// Server-side helpers for the Cashbook module: actor + permission checks,
// paise parsing, IST dates, balance maths, default masters.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import CashAccount from "@/models/CashAccount";
import CashCategory from "@/models/CashCategory";
import CashbookEntry from "@/models/CashbookEntry";

export class CbError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const CB_PERMISSION_KEYS = [
  "cashbookView",
  "cashbookEntry",
  "cashbookApprove",
  "cashbookEditApproved",
  "cashbookAdvance",
  "cashbookOrderPayment",
  "cashbookMasters",
  "cashbookReports",
  "cashbookAllEntries",
] as const;
export type CbPermission = (typeof CB_PERMISSION_KEYS)[number];

// Same hardcoded super-admins as app/api/login + lib/tasks/permissions.ts.
const HARDCODED_ADMINS = ["admin", "chintan", "hitesh"];

export interface CbActor {
  username: string;
  isAdmin: boolean;
  has: (p: CbPermission) => boolean;
}

/**
 * Identify the acting user from the x-oms-user header and re-read permissions
 * from the DB on every request. Same (spoofable) trust model as the rest of
 * the app: the username is client-supplied.
 */
export async function getCbActor(req: Request): Promise<CbActor> {
  await dbConnect();
  const url = new URL(req.url);
  const username = (req.headers.get("x-oms-user") || url.searchParams.get("username") || "").trim();
  if (!username) throw new CbError(401, "Login karo pehle (user pehchaan nahi hui)");

  let perms: Record<string, boolean> = {};
  let isAdmin = HARDCODED_ADMINS.includes(username.toLowerCase());
  if (!isAdmin) {
    const db = mongoose.connection.db;
    if (!db) throw new CbError(500, "Database connection not initialized");
    const user: any = await db.collection("users").findOne({ username }, { projection: { permissions: 1 } });
    if (!user) throw new CbError(401, "User nahi mila, dobara login karo");
    perms = user.permissions || {};
    isAdmin = perms.boss === true;
  }
  return { username, isAdmin, has: (p) => isAdmin || perms[p] === true };
}

export function requirePerm(actor: CbActor, ...any: CbPermission[]) {
  if (!any.some((p) => actor.has(p))) throw new CbError(403, "Aapko iski permission nahi hai");
}

/** Wrap a route handler: converts CbError / unexpected errors to JSON. */
export function cbHandler<A extends any[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e: any) {
      if (e instanceof CbError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("Cashbook API error:", e);
      return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
    }
  };
}

// ---------------------------------------------------------------- money
/** "1234.5" / 1234.5 -> 123450 paise. Pure string maths, no float rounding. */
export function toPaise(v: unknown): number {
  const s = String(v ?? "").trim().replace(/,/g, "");
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new CbError(400, "Amount sahi nahi hai (max 2 decimal)");
  const paise = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
  if (paise <= 0) throw new CbError(400, "Amount 0 se zyada hona chahiye");
  return paise;
}

// ---------------------------------------------------------------- dates (IST)
const IST_MS = 5.5 * 60 * 60 * 1000;
export const todayIST = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
export const isDateStr = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- defaults
const DEFAULT_CATEGORIES: { name: string; direction: "IN" | "OUT" | "BOTH"; system?: boolean }[] = [
  { name: "Courier", direction: "OUT" },
  { name: "Transport", direction: "OUT" },
  { name: "Packing", direction: "OUT" },
  { name: "Travel", direction: "OUT" },
  { name: "Office expense", direction: "OUT" },
  { name: "Purchase", direction: "OUT" },
  { name: "Other income", direction: "IN" },
  { name: "Order payment (cash)", direction: "IN", system: true },
];

/** Seed "Cash in hand" + default categories the first time the module is used. */
export async function ensureDefaults() {
  if ((await CashAccount.countDocuments({})) === 0) {
    await CashAccount.create({ name: "Cash in hand", type: "CASH", openingPaise: 0, openingDate: todayIST(), active: true });
  }
  if ((await CashCategory.countDocuments({})) === 0) {
    try {
      await CashCategory.insertMany(DEFAULT_CATEGORIES, { ordered: false });
    } catch {
      /* concurrent seed - unique index on name makes this safe */
    }
  }
}

// ---------------------------------------------------------------- balances
export interface Balances {
  accounts: Record<string, number>; // accountId -> paise
  staffTotal: number;
  perStaff: Record<string, number>;
}

/**
 * Balances counting every APPROVED entry with date < beforeDate (exclusive)
 * and every account whose openingDate <= beforeDate.
 *  account  = opening + IN - OUT   (top-up is an OUT of the account, return an IN)
 *  wallet   = top-ups - returns - approved spends paid from advance
 */
export async function computeBalances(beforeDate: string): Promise<Balances> {
  const accs: any[] = await CashAccount.find({}).lean();
  const accounts: Record<string, number> = {};
  for (const a of accs) accounts[String(a._id)] = a.openingDate <= beforeDate ? a.openingPaise || 0 : 0;

  const rows: any[] = await CashbookEntry.aggregate([
    { $match: { status: "APPROVED", date: { $lt: beforeDate } } },
    {
      $group: {
        _id: { account: "$account", direction: "$direction", type: "$type", paidFrom: "$paidFrom", staff: "$staff" },
        sum: { $sum: "$amountPaise" },
      },
    },
  ]);

  const perStaff: Record<string, number> = {};
  const bump = (staff: string, v: number) => (perStaff[staff] = (perStaff[staff] || 0) + v);
  for (const r of rows) {
    const { account, direction, type, paidFrom, staff } = r._id;
    if (account) {
      const k = String(account);
      accounts[k] = (accounts[k] || 0) + (direction === "IN" ? r.sum : -r.sum);
    }
    if (type === "ADVANCE_TOPUP") bump(staff, r.sum);
    else if (type === "ADVANCE_RETURN") bump(staff, -r.sum);
    else if (paidFrom === "STAFF_ADVANCE" && direction === "OUT") bump(staff, -r.sum);
  }
  const staffTotal = Object.values(perStaff).reduce((s, v) => s + v, 0);
  return { accounts, staffTotal, perStaff };
}

/** Plain, JSON-safe view of an entry for the client. */
export function serializeEntry(e: any) {
  return {
    id: String(e._id),
    date: e.date,
    createdAt: e.createdAt,
    direction: e.direction,
    type: e.type,
    amountPaise: e.amountPaise,
    mode: e.mode,
    accountId: e.account ? String(e.account) : null,
    paidFrom: e.paidFrom,
    staff: e.staff,
    categoryId: e.categoryId ? String(e.categoryId) : null,
    categoryName: e.categoryName,
    particulars: e.particulars,
    remark: e.remark,
    hasAttachment: !!e.attachmentKey,
    institute: e.institute || "",
    allocations: (e.allocations || []).map((a: any) => ({ orderId: String(a.order), orderNo: a.orderNo, amountPaise: a.amountPaise, deductionPaise: a.deductionPaise || 0 })),
    onAccountPaise: e.onAccountPaise || 0,
    onAccountAllocatedPaise: (e.onAccountAllocated || []).reduce((s: number, a: any) => s + (a.amountPaise || 0), 0),
    deductionPaise: e.deductionPaise || 0,
    deductionType: e.deductionType || null,
    status: e.status,
    rejectReason: e.rejectReason,
    enteredBy: e.enteredBy,
    approvedBy: e.approvedBy,
    approvedAt: e.approvedAt,
    audit: e.audit || [],
  };
}
