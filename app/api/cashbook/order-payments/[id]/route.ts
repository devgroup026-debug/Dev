import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { CbError, cbHandler, getCbActor, requirePerm, serializeEntry } from "@/lib/cashbook/server";
import { editOrderPayment } from "@/lib/cashbook/orderPayment";

export const PUT = cbHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookOrderPayment", "cashbookEditApproved");
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) throw new CbError(404, "Entry nahi mili");
  const doc = await editOrderPayment(id, await req.json(), actor);
  return NextResponse.json(serializeEntry(doc.toObject()));
});
