import { NextResponse } from "next/server";
import CashAccount from "@/models/CashAccount";
import CashbookEntry from "@/models/CashbookEntry";
import { cbHandler, getCbActor, requirePerm, ensureDefaults, isDateStr, todayIST, CbError } from "@/lib/cashbook/server";

const ser = (a: any) => ({
  id: String(a._id),
  name: a.name,
  type: a.type,
  firmCode: a.firmCode || "",
  openingPaise: a.openingPaise || 0,
  openingDate: a.openingDate,
  active: a.active,
});

// Any cashbook user may read the list (needed for the entry form dropdowns).
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView", "cashbookEntry", "cashbookMasters");
  await ensureDefaults();
  const list = await CashAccount.find({}).sort({ type: 1, name: 1 }).lean();
  return NextResponse.json(list.map(ser));
});

function parseOpening(v: unknown): number {
  // Opening balance may be 0 or negative-free; reuse paise parsing but allow 0.
  const s = String(v ?? "0").trim().replace(/,/g, "") || "0";
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new CbError(400, "Opening balance sahi nahi hai");
  return Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
}

export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookMasters");
  const b = await req.json();
  const name = String(b.name || "").trim();
  if (!name) throw new CbError(400, "Account ka naam likho");
  if (!["CASH", "BANK"].includes(b.type)) throw new CbError(400, "Type CASH ya BANK hona chahiye");
  const openingDate = isDateStr(b.openingDate) ? b.openingDate : todayIST();
  const created = await CashAccount.create({
    name,
    type: b.type,
    firmCode: String(b.firmCode || "").trim(),
    openingPaise: parseOpening(b.opening),
    openingDate,
    active: b.active !== false,
  });
  return NextResponse.json(ser(created), { status: 201 });
});

export const PUT = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookMasters");
  const b = await req.json();
  const acc: any = await CashAccount.findById(b.id);
  if (!acc) throw new CbError(404, "Account nahi mila");
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) throw new CbError(400, "Account ka naam likho");
    acc.name = name;
  }
  if (b.firmCode !== undefined) acc.firmCode = String(b.firmCode).trim();
  if (b.opening !== undefined) acc.openingPaise = parseOpening(b.opening);
  if (b.openingDate !== undefined) {
    if (!isDateStr(b.openingDate)) throw new CbError(400, "Opening date sahi nahi hai");
    acc.openingDate = b.openingDate;
  }
  if (b.active !== undefined) {
    if (b.active === false) {
      if (acc.type === "CASH" && (await CashAccount.countDocuments({ type: "CASH", active: true, _id: { $ne: acc._id } })) === 0)
        throw new CbError(400, "Kam se kam ek CASH account active rehna chahiye");
      const pending = await CashbookEntry.countDocuments({ account: acc._id, status: "PENDING" });
      if (pending) throw new CbError(400, `Is account mein ${pending} pending entries hain, pehle unhe nipta do`);
    }
    acc.active = !!b.active;
  }
  await acc.save();
  return NextResponse.json(ser(acc));
});
