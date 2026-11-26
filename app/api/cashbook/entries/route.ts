import { NextResponse } from "next/server";
import CashbookEntry from "@/models/CashbookEntry";
import { cbHandler, getCbActor, requirePerm, serializeEntry } from "@/lib/cashbook/server";
import { parseEntryInput } from "@/lib/cashbook/entryInput";

/**
 * List entries. Approvers see everyone's; everyone else only their own.
 * ?status=PENDING|REJECTED|APPROVED  ?mine=1 (force own only)
 */
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView", "cashbookEntry", "cashbookApprove");
  const sp = new URL(req.url).searchParams;
  const filter: any = { status: { $ne: "DELETED" } };
  const status = sp.get("status");
  if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) filter.status = status;
  if (!actor.has("cashbookApprove") || sp.get("mine") === "1") filter.enteredBy = actor.username;

  const rows = await CashbookEntry.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const total = rows.reduce((s: number, r: any) => s + (r.direction === "IN" ? r.amountPaise : -r.amountPaise), 0);
  const gross = rows.reduce((s: number, r: any) => s + r.amountPaise, 0);
  return NextResponse.json({ entries: rows.map(serializeEntry), count: rows.length, totalPaise: gross, netPaise: total });
});

export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookEntry");
  const data = await parseEntryInput(await req.json(), actor);

  // Owner (admin) / approver entries are auto-approved; staff entries start PENDING.
  const auto = actor.isAdmin || actor.has("cashbookApprove");
  const now = new Date();
  const doc = await CashbookEntry.create({
    ...data,
    type: "NORMAL",
    enteredBy: actor.username,
    status: auto ? "APPROVED" : "PENDING",
    approvedBy: auto ? actor.username : "",
    approvedAt: auto ? now : null,
    audit: [
      { action: "CREATED", by: actor.username, at: now },
      ...(auto ? [{ action: "APPROVED", by: actor.username, at: now, note: "auto-approved" }] : []),
    ],
  });
  return NextResponse.json(serializeEntry(doc.toObject()), { status: 201 });
});
