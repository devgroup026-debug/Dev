import { NextResponse } from "next/server";
import { cbHandler, getCbActor, requirePerm, serializeEntry } from "@/lib/cashbook/server";
import { createOrderPayment } from "@/lib/cashbook/orderPayment";

// Cash received from an institute. Body: { institute, amount, date?, accountId?, remark?,
// allocations: [{orderId, amount}], onAccount?, deduction?, deductionType? }
export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookOrderPayment");
  const doc = await createOrderPayment(await req.json(), actor);
  return NextResponse.json(serializeEntry(doc.toObject()), { status: 201 });
});
