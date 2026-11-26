import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ELIGIBLE_BILL_STATUSES } from "@/lib/reconciliation/matchingEngine";
import dbConnect from "@/lib/dbConnect";
import { cashReceiptTotals, onAccountByInstitute } from "@/lib/cashbook/orderPayment";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET: per-institute Total Billed / Total Received / Total TDS / Total GST / Total Kasar /
// Pending Amount, built from confirmed bank_reconciliation_matches (actual receipts + learned
// deduction classification) joined against sellerorders (billed totals), optionally scoped to
// one firm and/or one institute.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");
    const instituteName = searchParams.get("instituteName");

    const client = await clientPromise;
    const db = client.db();

    const billMatch: Record<string, any> = { status: { $in: ELIGIBLE_BILL_STATUSES } };
    if (firmCode) billMatch.firmCode = firmCode;
    if (instituteName) billMatch.instituteName = instituteName;

    const billTotals = await db
      .collection("sellerorders")
      .aggregate([
        { $match: billMatch },
        {
          $group: {
            _id: "$instituteName",
            totalBilled: { $sum: { $ifNull: ["$totalAmount", 0] } },
            totalSettled: {
              $sum: { $add: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$deductionAmount", 0] }] },
            },
          },
        },
      ])
      .toArray();

    const receiptMatch: Record<string, any> = { status: "confirmed" };
    if (firmCode) receiptMatch.firmCode = firmCode;
    if (instituteName) receiptMatch.instituteName = instituteName;

    const confirmedMatches = await db
      .collection("bank_reconciliation_matches")
      .find(receiptMatch)
      .toArray();

    const receiptTotals = new Map<
      string,
      { totalReceived: number; totalTDS: number; totalGST: number; totalKasar: number }
    >();

    for (const m of confirmedMatches) {
      const key = m.instituteName || "Unknown Institute";
      const entry = receiptTotals.get(key) || { totalReceived: 0, totalTDS: 0, totalGST: 0, totalKasar: 0 };
      entry.totalReceived = round2(entry.totalReceived + (m.creditedAmount || 0));

      const deduction = m.deductionAmount || 0;
      const type = m.correctedType || m.deductionType;
      if (type === "TDS") {
        entry.totalTDS = round2(entry.totalTDS + deduction);
      } else if (type === "TDS+GST") {
        // Split at the 2%/2% classifier band — TDS portion capped at 2% of the bill,
        // remainder attributed to GST.
        const tdsPortion = Math.min(deduction, round2((m.billAmount || 0) * 0.02));
        entry.totalTDS = round2(entry.totalTDS + tdsPortion);
        entry.totalGST = round2(entry.totalGST + (deduction - tdsPortion));
      } else if (type === "Kasar") {
        entry.totalKasar = round2(entry.totalKasar + deduction);
      }
      receiptTotals.set(key, entry);
    }

    const instituteNames = new Set([
      ...billTotals.map((b) => b._id),
      ...receiptTotals.keys(),
    ]);

    // Cashbook: cash received "on account" (not yet tied to an order) already
    // reduces the institute's total outstanding. It has no firm, so it is only
    // netted in the all-firms view.
    if (!firmCode) await dbConnect(); // cashbook models use mongoose
    const onAccount = firmCode ? new Map<string, number>() : await onAccountByInstitute();
    const cash = firmCode ? new Map<string, any>() : await cashReceiptTotals();

    const summary = [...instituteNames]
      .filter(Boolean)
      .map((name) => {
        const bill = billTotals.find((b) => b._id === name);
        const bank = receiptTotals.get(name!) || { totalReceived: 0, totalTDS: 0, totalGST: 0, totalKasar: 0 };
        // Cash receipts (Cashbook) add to received; their deduction (if any) is added by type.
        const c = cash.get(name!);
        const cashTds = c ? c.TDS + Math.min(c["TDS+GST"], round2(c["TDS+GST"] / 2)) : 0;
        const receipts = c
          ? {
              totalReceived: round2(bank.totalReceived + c.received),
              totalTDS: round2(bank.totalTDS + cashTds),
              totalGST: round2(bank.totalGST + (c["TDS+GST"] - Math.min(c["TDS+GST"], round2(c["TDS+GST"] / 2)))),
              totalKasar: round2(bank.totalKasar + c.Kasar),
            }
          : bank;
        const totalBilled = bill?.totalBilled || 0;
        const totalSettled = bill?.totalSettled || 0;
        return {
          instituteName: name,
          totalBilled: round2(totalBilled),
          pendingAmount: round2(Math.max(0, totalBilled - totalSettled - (onAccount.get(name!) || 0))),
          onAccount: onAccount.get(name!) || 0,
          ...receipts,
        };
      })
      .sort((a, b) => b.totalBilled - a.totalBilled);

    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("Party summary GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to build party summary" }, { status: 500 });
  }
}
