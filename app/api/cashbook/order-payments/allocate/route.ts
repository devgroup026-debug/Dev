import { NextResponse } from "next/server";
import { CbError, cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";
import { allocateOnAccount } from "@/lib/cashbook/orderPayment";

// "Order se jodo": body { institute, allocations: [{orderId, amount}] }
export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookOrderPayment");
  const b = await req.json();
  const institute = String(b.institute || "").trim();
  if (!institute) throw new CbError(400, "Institute chuno");
  return NextResponse.json({ ok: true, ...(await allocateOnAccount(institute, b.allocations, actor)) });
});
