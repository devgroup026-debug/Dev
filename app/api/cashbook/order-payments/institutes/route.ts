import { NextResponse } from "next/server";
import SellerOrder from "@/models/SellerOrder";
import { ELIGIBLE_BILL_STATUSES } from "@/lib/reconciliation/matchingEngine";
import { cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";
import { onAccountByInstitute } from "@/lib/cashbook/orderPayment";

// Institutes that still owe money (for the picker), with outstanding and on-account.
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookOrderPayment");
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  const match: any = { status: { $in: ELIGIBLE_BILL_STATUSES }, isPaid: { $ne: true } };
  if (q) match.instituteName = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const rows: any[] = await SellerOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$instituteName",
        orders: { $sum: 1 },
        outstanding: { $sum: { $max: [0, { $subtract: [{ $ifNull: ["$totalAmount", 0] }, { $add: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$deductionAmount", 0] }] }] }] } },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 60 },
  ]);
  const onAcc = await onAccountByInstitute();
  return NextResponse.json(
    rows.map((r) => ({ name: r._id, pendingOrders: r.orders, outstanding: Math.round(r.outstanding * 100) / 100, onAccount: onAcc.get(r._id) || 0 }))
  );
});
