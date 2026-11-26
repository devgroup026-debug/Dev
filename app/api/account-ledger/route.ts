import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import dbConnect from "@/lib/dbConnect";
import { onAccountByInstitute } from "@/lib/cashbook/orderPayment";

// GET: institute-wise order totals from the verified sellerorders collection,
// optionally scoped to one firm (?firmCode=XYZ).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");

    const client = await clientPromise;
    const db = client.db();

    const matchStage: Record<string, any> = {};
    if (firmCode) matchStage.firmCode = firmCode;

    const pipeline: any[] = [
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: "$instituteName",
          totalOrders: { $sum: 1 },
          totalValue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          paidValue: {
            $sum: { $cond: [{ $eq: ["$isPaid", true] }, { $ifNull: ["$totalAmount", 0] }, 0] },
          },
          pendingValue: {
            $sum: { $cond: [{ $eq: ["$isPaid", true] }, 0, { $ifNull: ["$totalAmount", 0] }] },
          },
          firmCodes: { $addToSet: "$firmCode" },
        },
      },
      { $sort: { totalValue: -1 } },
    ];

    const results = await db.collection("sellerorders").aggregate(pipeline).toArray();

    // Cashbook: cash received on account reduces the institute's outstanding straight away
    // (it has no firm, so only the all-firms view is netted).
    if (!firmCode) await dbConnect();
    const onAccount = firmCode ? new Map<string, number>() : await onAccountByInstitute();

    const ledger = results.map((r) => ({
      instituteName: r._id || "Unknown Institute",
      totalOrders: r.totalOrders,
      totalValue: r.totalValue,
      paidValue: r.paidValue,
      pendingValue: Math.max(0, r.pendingValue - (onAccount.get(r._id) || 0)),
      onAccountValue: onAccount.get(r._id) || 0,
      firmCodes: (r.firmCodes || []).filter(Boolean),
    }));

    return NextResponse.json(ledger);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to build ledger" }, { status: 500 });
  }
}
