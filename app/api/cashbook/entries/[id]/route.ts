import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CashbookEntry from "@/models/CashbookEntry";
import { CbActor, CbError, cbHandler, getCbActor, requirePerm, serializeEntry } from "@/lib/cashbook/server";
import { parseEntryInput } from "@/lib/cashbook/entryInput";
import { reverseOrderPayment } from "@/lib/cashbook/orderPayment";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new CbError(404, "Entry nahi mili");
  const e: any = await CashbookEntry.findById(id);
  if (!e || e.status === "DELETED") throw new CbError(404, "Entry nahi mili");
  return e;
}

function canSee(actor: CbActor, e: any) {
  return actor.has("cashbookApprove") || actor.has("cashbookAllEntries") || e.enteredBy === actor.username;
}

/** May the actor edit/delete this entry? (own while PENDING/REJECTED; approved only for editors) */
function assertCanModify(actor: CbActor, e: any) {
  if (e.status === "APPROVED") {
    if (!actor.has("cashbookEditApproved")) throw new CbError(403, "Approved entry sirf owner badal sakta hai");
    return;
  }
  const own = e.enteredBy === actor.username && actor.has("cashbookEntry");
  if (!own && !actor.has("cashbookEditApproved")) throw new CbError(403, "Aap sirf apni pending/rejected entry badal sakte ho");
}

export const GET = cbHandler(async (req: Request, { params }: Ctx) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView", "cashbookEntry");
  const e = await load((await params).id);
  if (!canSee(actor, e)) throw new CbError(403, "Yeh entry aap nahi dekh sakte");
  return NextResponse.json(serializeEntry(e.toObject()));
});

export const PUT = cbHandler(async (req: Request, { params }: Ctx) => {
  const actor = await getCbActor(req);
  const e = await load((await params).id);
  if (e.type === "ORDER_PAYMENT_CASH") throw new CbError(400, "Cash payment /api/cashbook/order-payments/[id] se edit hoti hai");
  assertCanModify(actor, e);
  if (e.type !== "NORMAL") throw new CbError(400, "Is type ki entry yahan se edit nahi hoti");
  const body = await req.json();
  const data = await parseEntryInput(body, actor);
  // An editor fixing someone else's advance expense must not move it to their own wallet.
  if (data.paidFrom === "STAFF_ADVANCE" && e.paidFrom === "STAFF_ADVANCE" && e.staff && !body.staff) data.staff = e.staff;

  // No new upload on edit = keep the existing bill.
  if (!data.attachmentKey) data.attachmentKey = e.attachmentKey || "";
  const now = new Date();
  const wasApproved = e.status === "APPROVED";
  const auto = actor.isAdmin || actor.has("cashbookApprove");
  Object.assign(e, data);
  if (wasApproved) {
    e.audit.push({ action: "EDITED", by: actor.username, at: now });
  } else if (auto) {
    e.status = "APPROVED";
    e.approvedBy = actor.username;
    e.approvedAt = now;
    e.rejectReason = "";
    e.audit.push({ action: "EDITED", by: actor.username, at: now }, { action: "APPROVED", by: actor.username, at: now, note: "auto-approved" });
  } else {
    const wasRejected = e.status === "REJECTED";
    e.status = "PENDING";
    e.rejectReason = "";
    e.audit.push({ action: wasRejected ? "RESUBMITTED" : "EDITED", by: actor.username, at: now });
  }
  await e.save();
  return NextResponse.json(serializeEntry(e.toObject()));
});

// Soft delete: status DELETED keeps the audit trail but drops it from every total/list.
export const DELETE = cbHandler(async (req: Request, { params }: Ctx) => {
  const actor = await getCbActor(req);
  const e = await load((await params).id);
  if (e.type === "ADVANCE_TOPUP" || e.type === "ADVANCE_RETURN") {
    // Transfers: only advance managers may remove them (balances are derived, so nothing else to undo).
    requirePerm(actor, "cashbookAdvance");
  } else if (e.type === "ORDER_PAYMENT_CASH") {
    if (e.status === "APPROVED") {
      // Reverses cashbook balance, orders, on-account and pending/received in one transaction.
      requirePerm(actor, "cashbookEditApproved");
      await reverseOrderPayment(String(e._id), actor, "DELETED");
      return NextResponse.json({ ok: true });
    }
    const own = e.enteredBy === actor.username && actor.has("cashbookOrderPayment");
    if (!own && !actor.has("cashbookEditApproved")) throw new CbError(403, "Aap sirf apni pending/rejected entry delete kar sakte ho");
  } else {
    assertCanModify(actor, e);
    if (e.type !== "NORMAL") throw new CbError(400, "Is type ki entry yahan se delete nahi hoti");
  }
  e.status = "DELETED";
  e.audit.push({ action: "DELETED", by: actor.username, at: new Date() });
  await e.save();
  return NextResponse.json({ ok: true });
});
