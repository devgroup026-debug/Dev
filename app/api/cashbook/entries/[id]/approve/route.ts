import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CashbookEntry from "@/models/CashbookEntry";
import { CbError, cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";
import { approveOrderPayment } from "@/lib/cashbook/orderPayment";

// Idempotent: the conditional update only matches a PENDING entry, so a second
// approve (double click / retry) can never post twice.
export const POST = cbHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookApprove");
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) throw new CbError(404, "Entry nahi mili");

  const entry: any = await CashbookEntry.findById(id).select("type status").lean();
  if (!entry || entry.status === "DELETED") throw new CbError(404, "Entry nahi mili");

  // Cash payment from an institute also posts to orders: done in one transaction.
  if (entry.type === "ORDER_PAYMENT_CASH") {
    const r = await approveOrderPayment(id, actor);
    if (r === "invalid") throw new CbError(409, "Yeh entry approve nahi ho sakti (status: " + entry.status + ")");
    return NextResponse.json({ ok: true, alreadyApproved: r === "already" });
  }

  const now = new Date();
  const done = await CashbookEntry.findOneAndUpdate(
    { _id: id, status: "PENDING" },
    {
      $set: { status: "APPROVED", approvedBy: actor.username, approvedAt: now, rejectReason: "" },
      $push: { audit: { action: "APPROVED", by: actor.username, at: now } },
    }
  );
  if (!done) {
    const e: any = await CashbookEntry.findById(id).lean();
    if (e.status === "APPROVED") return NextResponse.json({ ok: true, alreadyApproved: true });
    throw new CbError(409, "Yeh entry approve nahi ho sakti (status: " + e.status + ")");
  }
  return NextResponse.json({ ok: true });
});
