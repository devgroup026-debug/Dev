import { NextResponse } from "next/server";
import SellerOrder from "@/models/SellerOrder";
import CashbookEntry from "@/models/CashbookEntry";
import { ELIGIBLE_BILL_STATUSES } from "@/lib/reconciliation/matchingEngine";
import { CbError, cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";
import { onAccountRemainingPaise, outstandingPaise } from "@/lib/cashbook/orderPayment";

/**
 * Pending orders of one institute, oldest first, with outstanding in paise.
 * ?excludeEntry=<id>: used when editing an approved receipt - outstanding is shown
 * as it was before that receipt, and orders it fully settled are listed again.
 */
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookOrderPayment");
  const sp = new URL(req.url).searchParams;
  const institute = (sp.get("institute") || "").trim();
  if (!institute) throw new CbError(400, "Institute chuno");

  // What an existing approved receipt already put on each order.
  const credit = new Map<string, number>();
  const exclude = sp.get("excludeEntry");
  if (exclude) {
    const e: any = await CashbookEntry.findOne({ _id: exclude, status: "APPROVED", type: "ORDER_PAYMENT_CASH" }).lean();
    if (e) {
      for (const a of e.allocations || []) credit.set(String(a.order), (credit.get(String(a.order)) || 0) + a.amountPaise + (a.deductionPaise || 0));
      for (const a of e.onAccountAllocated || []) credit.set(String(a.order), (credit.get(String(a.order)) || 0) + a.amountPaise);
    }
  }

  const orders: any[] = await SellerOrder.find({
    instituteName: institute,
    status: { $in: ELIGIBLE_BILL_STATUSES },
    $or: [{ isPaid: { $ne: true } }, ...(credit.size ? [{ _id: { $in: [...credit.keys()] } }] : [])],
  })
    .sort({ contractDate: 1, createdAt: 1 })
    .lean();

  const list = orders
    .map((o) => ({
      id: String(o._id),
      orderNo: o.orderNo,
      contractDate: o.contractDate || "",
      itemName: o.itemName,
      totalPaise: Math.round((o.totalAmount || 0) * 100),
      outstandingPaise: outstandingPaise(o) + (credit.get(String(o._id)) || 0),
    }))
    .filter((o) => o.outstandingPaise > 0);

  const receipts: any[] = await CashbookEntry.find({ type: "ORDER_PAYMENT_CASH", status: "APPROVED", institute, onAccountPaise: { $gt: 0 } }).lean();
  const onAccountPaise = receipts.filter((r) => String(r._id) !== exclude).reduce((s, r) => s + Math.max(0, onAccountRemainingPaise(r)), 0);

  return NextResponse.json({
    orders: list,
    totalOutstandingPaise: list.reduce((s, o) => s + o.outstandingPaise, 0),
    onAccountPaise,
  });
});
