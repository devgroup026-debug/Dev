import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { addDays, cbHandler, computeBalances, getCbActor, requirePerm, todayIST } from "@/lib/cashbook/server";

// Staff picker for the advance screen, with each person's current wallet balance.
export const GET = cbHandler(async (req: Request) => {
  const actor = await getCbActor(req);
  requirePerm(actor, "cashbookAdvance");
  const db = mongoose.connection.db!;
  const users: any[] = await db.collection("users").find({}, { projection: { username: 1 } }).toArray();
  const { perStaff } = await computeBalances(addDays(todayIST(), 1));
  const names = new Set<string>([...users.map((u) => u.username), ...Object.keys(perStaff)].filter(Boolean));
  const list = [...names].sort((a, b) => a.localeCompare(b)).map((username) => ({ username, balancePaise: perStaff[username] || 0 }));
  return NextResponse.json(list);
});
