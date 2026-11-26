import { NextResponse } from "next/server";
import CashbookEntry from "@/models/CashbookEntry";
import { CbError, cbHandler, getCbActor, requirePerm, serializeEntry } from "@/lib/cashbook/server";
import { onAccountRemainingPaise } from "@/lib/cashbook/orderPayment";

// Cash receipts of one institute for the institute ledger: receipts, on-account balance.
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookOrderPayment", "cashbookAllEntries", "cashbookApprove");
  const institute = (new URL(req.url).searchParams.get("institute") || "").trim();
  if (!institute) throw new CbError(400, "Institute chuno");
  const rows: any[] = await CashbookEntry.find({ type: "ORDER_PAYMENT_CASH", institute, status: { $in: ["APPROVED", "PENDING"] } })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  const receipts = rows.map((r) => ({ ...serializeEntry(r), onAccountRemainingPaise: r.status === "APPROVED" ? Math.max(0, onAccountRemainingPaise(r)) : 0 }));
  return NextResponse.json({
    receipts,
    onAccountPaise: receipts.reduce((s, r) => s + r.onAccountRemainingPaise, 0),
    canAllocate: actor.has("cashbookOrderPayment"),
  });
});
