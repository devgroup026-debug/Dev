import { NextResponse } from "next/server";
import mongoose from "mongoose";
import CashbookEntry from "@/models/CashbookEntry";
import { getSignedDownloadUrl } from "@/lib/cloudflareR2";
import { CbError, cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";

export const GET = cbHandler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView");
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) throw new CbError(404, "Entry nahi mili");
  const e: any = await CashbookEntry.findById(id).lean();
  if (!e || e.status === "DELETED" || !e.attachmentKey) throw new CbError(404, "Bill nahi mila");
  const seeAll = actor.has("cashbookApprove") || actor.has("cashbookAllEntries");
  if (!seeAll && e.enteredBy !== actor.username) throw new CbError(403, "Yeh entry aap nahi dekh sakte");
  return NextResponse.json({ url: await getSignedDownloadUrl(e.attachmentKey, 600) });
});
