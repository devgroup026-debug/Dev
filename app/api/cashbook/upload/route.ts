import { NextResponse } from "next/server";
import { uploadFileToR2 } from "@/lib/cloudflareR2";
import { CbError, cbHandler, getCbActor, requirePerm } from "@/lib/cashbook/server";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

// Bill / receipt photo -> R2. Only the key is stored on the entry.
export const POST = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookEntry");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new CbError(400, "File nahi mili");
  if (file.size > MAX_BYTES) throw new CbError(400, "File 8 MB se badi hai");
  if (!ALLOWED.includes(file.type)) throw new CbError(400, "Sirf photo (jpg/png/webp) ya PDF chalegi");
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `cashbook-bills/${Date.now()}-${safe}`;
  await uploadFileToR2(Buffer.from(await file.arrayBuffer()), key, file.type);
  return NextResponse.json({ key });
});
