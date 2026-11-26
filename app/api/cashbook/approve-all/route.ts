import { NextResponse } from "next/server";
import CashbookEntry from "@/models/CashbookEntry";
import { cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";
import { approveOrderPayment } from "@/lib/cashbook/orderPayment";

// Approve every PENDING entry (or just body.ids). Conditional on status, so safe to repeat.
// Plain entries are one bulk update; cash payments from institutes each get their own transaction
// (a failure in one - e.g. an order already settled - does not block the rest).
export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookApprove");
  const body = await req.json().catch(() => ({}));
  const filter: any = { status: "PENDING" };
  if (Array.isArray(body?.ids)) filter._id = { $in: body.ids };

  const now = new Date();
  const res = await CashbookEntry.updateMany(
    { ...filter, type: { $ne: "ORDER_PAYMENT_CASH" } },
    {
      $set: { status: "APPROVED", approvedBy: actor.username, approvedAt: now, rejectReason: "" },
      $push: { audit: { action: "APPROVED", by: actor.username, at: now } },
    }
  );
  let approved = res.modifiedCount;

  const cash: any[] = await CashbookEntry.find({ ...filter, type: "ORDER_PAYMENT_CASH" }).select("_id particulars").lean();
  const failed: { id: string; particulars: string; error: string }[] = [];
  for (const c of cash) {
    try {
      if ((await approveOrderPayment(String(c._id), actor)) === "approved") approved++;
    } catch (e: any) {
      failed.push({ id: String(c._id), particulars: c.particulars, error: e?.message || "Failed" });
    }
  }
  return NextResponse.json({ ok: failed.length === 0, approved, failed });
});
