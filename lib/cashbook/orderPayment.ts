// Cash payment received from an institute (Cashbook Phase 3).
//
// Money moves in ONE MongoDB transaction: the cashbook entry flips to APPROVED
// and every order it pays is updated together. The order maths deliberately
// mirrors lib/reconciliation/paymentEngine.ts (same round2, same Rs 5
// tolerance, same Paid/Partial rules) but runs on a session, which the shared
// bank-reconciliation helpers do not support - that code is left untouched.
import mongoose, { ClientSession } from "mongoose";
import SellerOrder from "@/models/SellerOrder";
import CashAccount from "@/models/CashAccount";
import CashCategory from "@/models/CashCategory";
import CashbookEntry from "@/models/CashbookEntry";
import { ELIGIBLE_BILL_STATUSES } from "@/lib/reconciliation/matchingEngine";
import { CbActor, CbError, isDateStr, toPaise, todayIST } from "./server";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rupees = (paise: number) => round2(paise / 100);
const DEDUCTION_TYPES = ["TDS", "TDS+GST", "Kasar"];
export const ORDER_PAYMENT_CATEGORY = "Order payment (cash)";

export async function inTx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } catch (e: any) {
    if (e?.name === "VersionError") throw new CbError(409, "Order usi waqt kisi aur ne badla, dobara try karo");
    throw e;
  } finally {
    await session.endSession();
  }
}

/** What an order still owes, in paise. */
export const outstandingPaise = (o: any) =>
  Math.max(0, Math.round((Number(o.totalAmount || 0) - Number(o.paidAmount || 0) - Number(o.deductionAmount || 0)) * 100));

// ------------------------------------------------------------ order effects
async function applyToOrder(session: ClientSession, orderId: any, amountPaise: number, deductionPaise: number, deductionType: string | null) {
  const bill: any = await SellerOrder.findById(orderId).session(session);
  if (!bill) throw new CbError(400, "Order nahi mila (delete ho gaya?)");
  const paid = round2((bill.paidAmount || 0) + rupees(amountPaise));
  const ded = round2((bill.deductionAmount || 0) + rupees(deductionPaise));
  const total = bill.totalAmount || 0;
  if (paid + ded > total + 5)
    throw new CbError(400, `Order ${bill.orderNo} par ₹${round2(paid + ded)} ho jayega jabki total ₹${total} hai (shayad pehle hi settle ho chuka)`);
  const settled = paid + ded >= total - 5;
  bill.paidAmount = paid;
  bill.deductionAmount = ded;
  if (deductionPaise > 0 && deductionType) bill.deductionType = deductionType;
  bill.paymentStatus = settled ? "Paid" : "Partial";
  bill.isPaid = settled;
  await bill.save({ session });
}

async function reverseOnOrder(session: ClientSession, orderId: any, amountPaise: number, deductionPaise: number) {
  const bill: any = await SellerOrder.findById(orderId).session(session);
  if (!bill) return; // order deleted since - nothing left to restore
  const paid = Math.max(0, round2((bill.paidAmount || 0) - rupees(amountPaise)));
  const ded = Math.max(0, round2((bill.deductionAmount || 0) - rupees(deductionPaise)));
  const settled = paid + ded >= (bill.totalAmount || 0) - 5;
  bill.paidAmount = paid;
  bill.deductionAmount = ded;
  bill.paymentStatus = paid + ded <= 0 ? "Pending" : settled ? "Paid" : "Partial";
  bill.isPaid = settled && paid + ded > 0;
  if (bill.paymentStatus === "Pending") {
    bill.deductionType = null;
    bill.deductionReason = "";
  }
  await bill.save({ session });
}

async function applyEntryEffects(session: ClientSession, e: any) {
  for (const a of e.allocations || []) await applyToOrder(session, a.order, a.amountPaise, a.deductionPaise || 0, e.deductionType);
}

async function reverseEntryEffects(session: ClientSession, e: any) {
  for (const a of e.allocations || []) await reverseOnOrder(session, a.order, a.amountPaise, a.deductionPaise || 0);
  // Money that was parked "on account" and later joined to orders came from this receipt too.
  for (const a of e.onAccountAllocated || []) await reverseOnOrder(session, a.order, a.amountPaise, 0);
}

// ------------------------------------------------------------ input
export async function parseOrderPaymentInput(b: any, session?: ClientSession) {
  const institute = String(b.institute || "").trim();
  if (!institute) throw new CbError(400, "Institute chuno");
  const amountPaise = toPaise(b.amount);

  const date = b.date || todayIST();
  if (!isDateStr(date) || date > todayIST()) throw new CbError(400, "Date sahi nahi hai");

  const accQuery = b.accountId ? CashAccount.findById(b.accountId) : CashAccount.findOne({ type: "CASH", active: true }).sort({ createdAt: 1 });
  const account: any = await accQuery.session(session || null);
  if (!account || !account.active || account.type !== "CASH") throw new CbError(400, "Cash account chuno");

  let cat: any = await CashCategory.findOne({ name: ORDER_PAYMENT_CATEGORY }).session(session || null);
  if (!cat) [cat] = await CashCategory.create([{ name: ORDER_PAYMENT_CATEGORY, direction: "IN", system: true }], { session: session || undefined });

  // Allocations to specific orders (everything else stays on account).
  const raw: any[] = Array.isArray(b.allocations) ? b.allocations.filter((a: any) => a && String(a.amount ?? "").trim() !== "" && Number(a.amount) !== 0) : [];
  const seen = new Set<string>();
  let allocated = 0;
  const allocations: { order: any; orderNo: string; amountPaise: number; deductionPaise: number }[] = [];
  const outstanding: number[] = [];
  for (const a of raw) {
    if (!mongoose.isValidObjectId(a.orderId)) throw new CbError(400, "Order sahi nahi hai");
    if (seen.has(String(a.orderId))) throw new CbError(400, "Ek order do baar nahi chun sakte");
    seen.add(String(a.orderId));
    const order: any = await SellerOrder.findById(a.orderId).session(session || null);
    if (!order || order.instituteName !== institute) throw new CbError(400, "Order is institute ka nahi hai");
    if (!ELIGIBLE_BILL_STATUSES.includes(order.status)) throw new CbError(400, `Order ${order.orderNo} abhi payment ke layak status mein nahi hai`);
    const out = outstandingPaise(order);
    const amt = toPaise(a.amount);
    if (amt > out) throw new CbError(400, `Order ${order.orderNo}: ₹${amt / 100} outstanding ₹${out / 100} se zyada hai`);
    allocated += amt;
    allocations.push({ order: order._id, orderNo: order.orderNo, amountPaise: amt, deductionPaise: 0 });
    outstanding.push(out);
  }
  if (allocated > amountPaise) throw new CbError(400, "Orders ko baante gaye paise received amount se zyada hain");
  const onAccountPaise = amountPaise - allocated;
  if (b.onAccount !== undefined && b.onAccount !== "" && toPaiseOrZero(b.onAccount) !== onAccountPaise)
    throw new CbError(400, "Orders + On account ka total received amount ke barabar hona chahiye");

  // Optional deduction, applied to the allocated orders oldest-first up to what each still owes.
  let deductionPaise = 0;
  let deductionType: string | null = null;
  if (b.deduction !== undefined && String(b.deduction).trim() !== "" && toPaiseOrZero(b.deduction) > 0) {
    deductionPaise = toPaiseOrZero(b.deduction);
    if (!DEDUCTION_TYPES.includes(b.deductionType)) throw new CbError(400, "Deduction ka type chuno (TDS / TDS+GST / Kasar)");
    deductionType = b.deductionType;
    if (allocations.length === 0) throw new CbError(400, "Deduction sirf order ko baante gaye paison par lagta hai");
    let left = deductionPaise;
    allocations.forEach((a, i) => {
      const d = Math.min(left, outstanding[i] - a.amountPaise);
      a.deductionPaise = d;
      left -= d;
    });
    if (left > 0) throw new CbError(400, "Deduction orders ke bache hue outstanding se zyada hai");
  }

  return {
    date,
    direction: "IN" as const,
    type: "ORDER_PAYMENT_CASH" as const,
    amountPaise,
    mode: "CASH" as const,
    account: account._id,
    paidFrom: "ACCOUNT" as const,
    categoryId: cat._id,
    categoryName: ORDER_PAYMENT_CATEGORY,
    institute,
    particulars: `Cash received: ${institute}`,
    remark: String(b.remark || "").trim(),
    allocations,
    onAccountPaise,
    deductionPaise,
    deductionType: deductionType as any,
  };
}

function toPaiseOrZero(v: unknown) {
  const s = String(v ?? "").trim();
  return s === "" || Number(s) === 0 ? 0 : toPaise(s);
}

// ------------------------------------------------------------ lifecycle
const canAuto = (actor: CbActor) => actor.isAdmin || actor.has("cashbookApprove");

/** Create a receipt. Owner/approver receipts are posted immediately (one transaction); staff's wait as PENDING. */
export async function createOrderPayment(b: any, actor: CbActor) {
  return inTx(async (session) => {
    const data = await parseOrderPaymentInput(b, session);
    const auto = canAuto(actor);
    const now = new Date();
    const [doc]: any[] = await CashbookEntry.create(
      [{
        ...data,
        enteredBy: actor.username,
        status: auto ? "APPROVED" : "PENDING",
        approvedBy: auto ? actor.username : "",
        approvedAt: auto ? now : null,
        audit: [
          { action: "CREATED", by: actor.username, at: now },
          ...(auto ? [{ action: "APPROVED", by: actor.username, at: now, note: "auto-approved" }] : []),
        ],
      }],
      { session }
    );
    if (auto) await applyEntryEffects(session, doc);
    return doc;
  });
}

/** Approve a PENDING receipt. Idempotent: a second call finds nothing PENDING and posts nothing. */
export async function approveOrderPayment(entryId: string, actor: CbActor): Promise<"approved" | "already" | "invalid"> {
  const res = await inTx(async (session) => {
    const now = new Date();
    const e: any = await CashbookEntry.findOneAndUpdate(
      { _id: entryId, status: "PENDING", type: "ORDER_PAYMENT_CASH" },
      {
        $set: { status: "APPROVED", approvedBy: actor.username, approvedAt: now, rejectReason: "" },
        $push: { audit: { action: "APPROVED", by: actor.username, at: now } },
      },
      { session, new: true }
    );
    if (!e) return null;
    await applyEntryEffects(session, e);
    return e;
  });
  if (res) return "approved";
  const cur: any = await CashbookEntry.findById(entryId).lean();
  return cur?.status === "APPROVED" ? "already" : "invalid";
}

/** Undo an APPROVED receipt everywhere, then park it as REJECTED / DELETED. */
export async function reverseOrderPayment(entryId: string, actor: CbActor, finalStatus: "REJECTED" | "DELETED", reason = "") {
  return inTx(async (session) => {
    const e: any = await CashbookEntry.findOne({ _id: entryId, status: "APPROVED", type: "ORDER_PAYMENT_CASH" }).session(session);
    if (!e) throw new CbError(409, "Yeh payment ab approved nahi hai");
    await reverseEntryEffects(session, e);
    e.status = finalStatus;
    e.onAccountAllocated = [];
    e.rejectReason = finalStatus === "REJECTED" ? reason : e.rejectReason;
    e.approvedBy = "";
    e.approvedAt = null;
    e.audit.push({ action: finalStatus === "REJECTED" ? "REJECTED" : "DELETED", by: actor.username, at: new Date(), note: reason || "payment reversed" });
    await e.save({ session });
  });
}

/** Edit a receipt. An approved one is reversed and re-applied inside the same transaction. */
export async function editOrderPayment(entryId: string, b: any, actor: CbActor) {
  return inTx(async (session) => {
    const e: any = await CashbookEntry.findOne({ _id: entryId, type: "ORDER_PAYMENT_CASH", status: { $ne: "DELETED" } }).session(session);
    if (!e) throw new CbError(404, "Entry nahi mili");
    const wasApproved = e.status === "APPROVED";
    if (wasApproved) {
      if (!actor.has("cashbookEditApproved")) throw new CbError(403, "Approved payment sirf owner badal sakta hai");
      await reverseEntryEffects(session, e);
      e.onAccountAllocated = [];
    } else {
      const own = e.enteredBy === actor.username && actor.has("cashbookOrderPayment");
      if (!own && !actor.has("cashbookEditApproved")) throw new CbError(403, "Aap sirf apni pending/rejected entry badal sakte ho");
    }
    // Validation runs after the reversal, so the orders show what they owed before this receipt.
    const data = await parseOrderPaymentInput(b, session);
    const now = new Date();
    Object.assign(e, data);
    if (wasApproved) {
      e.audit.push({ action: "EDITED", by: actor.username, at: now });
      await applyEntryEffects(session, e);
    } else if (canAuto(actor)) {
      e.status = "APPROVED";
      e.approvedBy = actor.username;
      e.approvedAt = now;
      e.rejectReason = "";
      e.audit.push({ action: "EDITED", by: actor.username, at: now }, { action: "APPROVED", by: actor.username, at: now, note: "auto-approved" });
      await applyEntryEffects(session, e);
    } else {
      const wasRejected = e.status === "REJECTED";
      e.status = "PENDING";
      e.rejectReason = "";
      e.audit.push({ action: wasRejected ? "RESUBMITTED" : "EDITED", by: actor.username, at: now });
    }
    await e.save({ session });
    return e;
  });
}

// ------------------------------------------------------------ on account
export const onAccountRemainingPaise = (e: any) =>
  (e.onAccountPaise || 0) - (e.onAccountAllocated || []).reduce((s: number, a: any) => s + (a.amountPaise || 0), 0);

/**
 * "Order se jodo": move parked on-account money onto orders. Updates the orders
 * only - no cashbook movement, no new cashbook entry. Money is taken from the
 * institute's receipts oldest first, and each chunk is recorded on its receipt so
 * a later reversal can undo it exactly.
 */
export async function allocateOnAccount(institute: string, rawAllocs: any[], actor: CbActor) {
  return inTx(async (session) => {
    const receipts: any[] = await CashbookEntry.find({ type: "ORDER_PAYMENT_CASH", status: "APPROVED", institute, onAccountPaise: { $gt: 0 } })
      .sort({ createdAt: 1 })
      .session(session);
    const available = receipts.reduce((s, r) => s + Math.max(0, onAccountRemainingPaise(r)), 0);
    if (available <= 0) throw new CbError(400, "Is institute ka on-account paisa nahi hai");

    const wanted = (rawAllocs || []).filter((a) => a && Number(a.amount) !== 0 && String(a.amount ?? "").trim() !== "");
    if (wanted.length === 0) throw new CbError(400, "Kam se kam ek order mein amount likho");
    const seen = new Set<string>();
    let total = 0;
    const now = new Date();
    for (const a of wanted) {
      if (!mongoose.isValidObjectId(a.orderId) || seen.has(String(a.orderId))) throw new CbError(400, "Order sahi nahi hai");
      seen.add(String(a.orderId));
      const order: any = await SellerOrder.findById(a.orderId).session(session);
      if (!order || order.instituteName !== institute) throw new CbError(400, "Order is institute ka nahi hai");
      const out = outstandingPaise(order);
      const amt = toPaise(a.amount);
      if (amt > out) throw new CbError(400, `Order ${order.orderNo}: ₹${amt / 100} outstanding ₹${out / 100} se zyada hai`);
      total += amt;
      if (total > available) throw new CbError(400, `On-account sirf ₹${available / 100} hai`);

      let need = amt;
      for (const r of receipts) {
        if (need <= 0) break;
        const take = Math.min(need, Math.max(0, onAccountRemainingPaise(r)));
        if (take <= 0) continue;
        r.onAccountAllocated.push({ order: order._id, orderNo: order.orderNo, amountPaise: take, at: now, by: actor.username });
        need -= take;
      }
      await applyToOrder(session, order._id, amt, 0, null);
    }
    for (const r of receipts) if (r.isModified()) await r.save({ session });
    return { allocatedPaise: total };
  });
}

/** Approved cash receipts per institute (rupees): total received + deductions by type. */
export async function cashReceiptTotals(): Promise<Map<string, { received: number; TDS: number; "TDS+GST": number; Kasar: number }>> {
  const rows: any[] = await CashbookEntry.aggregate([
    { $match: { type: "ORDER_PAYMENT_CASH", status: "APPROVED" } },
    { $group: { _id: { i: "$institute", t: "$deductionType" }, received: { $sum: "$amountPaise" }, ded: { $sum: "$deductionPaise" } } },
  ]);
  const m = new Map<string, { received: number; TDS: number; "TDS+GST": number; Kasar: number }>();
  for (const r of rows) {
    const cur = m.get(r._id.i) || { received: 0, TDS: 0, "TDS+GST": 0, Kasar: 0 };
    cur.received = round2(cur.received + rupees(r.received));
    if (r._id.t && r.ded) cur[r._id.t as "TDS" | "TDS+GST" | "Kasar"] = round2(cur[r._id.t as "TDS"] + rupees(r.ded));
    m.set(r._id.i, cur);
  }
  return m;
}

/** Institute on-account balance (rupees) for every institute - used to net the ledgers' outstanding. */
export async function onAccountByInstitute(): Promise<Map<string, number>> {
  const rows: any[] = await CashbookEntry.aggregate([
    { $match: { type: "ORDER_PAYMENT_CASH", status: "APPROVED", onAccountPaise: { $gt: 0 } } },
    { $group: { _id: "$institute", parked: { $sum: "$onAccountPaise" }, used: { $sum: { $sum: "$onAccountAllocated.amountPaise" } } } },
  ]);
  const m = new Map<string, number>();
  for (const r of rows) if (r.parked - r.used > 0) m.set(r._id, rupees(r.parked - r.used));
  return m;
}
