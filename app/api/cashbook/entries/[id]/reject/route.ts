import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CashbookEntry from "@/models/CashbookEntry";
import { CbError, cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";
import { reverseOrderPayment } from "@/lib/cashbook/orderPayment";

export const POST = cbHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookApprove");
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) throw new CbError(404, "Entry nahi mili");
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason || "").trim();
  if (!reason) throw new CbError(400, "Reject karne ka reason likhna zaroori hai");
  // Rejecting an already-approved cash payment undoes it everywhere (owner/editor only).
  const cur: any = await CashbookEntry.findById(id).select("type status").lean();
  if (cur?.type === "ORDER_PAYMENT_CASH" && cur.status === "APPROVED") {
    requirePerm(actor, "cashbookEditApproved");
    await reverseOrderPayment(id, actor, "REJECTED", reason);
    return NextResponse.json({ ok: true, reversed: true });
  }
  const now = new Date();
  const done = await CashbookEntry.findOneAndUpdate(
    { _id: id, status: "PENDING" },
    {
      $set: { status: "REJECTED", rejectReason: reason, approvedBy: "", approvedAt: null },
      $push: { audit: { action: "REJECTED", by: actor.username, at: now, note: reason } },
    }
  );
  if (!done) throw new CbError(409, "Sirf pending entry reject ho sakti hai");
  return NextResponse.json({ ok: true });
});
