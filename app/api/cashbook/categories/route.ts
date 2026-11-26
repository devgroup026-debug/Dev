import { NextResponse } from "next/server";
import CashCategory from "@/models/CashCategory";
import { cbHandler, getCbActor, requirePerm, ensureDefaults, CbError } from "@/lib/cashbook/server";

const ser = (c: any) => ({ id: String(c._id), name: c.name, direction: c.direction, system: !!c.system, active: c.active });
const DIRS = ["IN", "OUT", "BOTH"];

export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookView", "cashbookEntry", "cashbookMasters");
  await ensureDefaults();
  const list = await CashCategory.find({}).sort({ name: 1 }).lean();
  return NextResponse.json(list.map(ser));
});

export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookMasters");
  const b = await req.json();
  const name = String(b.name || "").trim();
  if (!name) throw new CbError(400, "Category ka naam likho");
  if (await CashCategory.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }))
    throw new CbError(400, "Yeh category pehle se hai");
  const created = await CashCategory.create({ name, direction: DIRS.includes(b.direction) ? b.direction : "BOTH" });
  return NextResponse.json(ser(created), { status: 201 });
});

export const PUT = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookMasters");
  const b = await req.json();
  const cat: any = await CashCategory.findById(b.id);
  if (!cat) throw new CbError(404, "Category nahi mili");
  if (cat.system && (b.name !== undefined || b.active === false))
    throw new CbError(400, "System category ko rename ya band nahi kar sakte");
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) throw new CbError(400, "Category ka naam likho");
    cat.name = name;
  }
  if (b.direction !== undefined && DIRS.includes(b.direction)) cat.direction = b.direction;
  if (b.active !== undefined) cat.active = !!b.active;
  try {
    await cat.save();
  } catch (e: any) {
    if (e?.code === 11000) throw new CbError(400, "Yeh naam pehle se hai");
    throw e;
  }
  return NextResponse.json(ser(cat));
});
