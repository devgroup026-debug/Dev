"use client";
// Institute ledger add-on (Buyer Ledger page): cash receipts from the Cashbook, the
// "On account" balance and the "Order se jodo" allocation dialog.
import { useEffect, useState } from "react";
import { cbFetch, fmtPaise } from "@/lib/cashbook/client";

export interface CashReceipt {
  id: string;
  date: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  amountPaise: number;
  onAccountPaise: number;
  onAccountRemainingPaise: number;
  deductionPaise: number;
  deductionType: string | null;
  allocations: { orderId: string; orderNo: string; amountPaise: number; deductionPaise: number }[];
  enteredBy: string;
}
type PendingOrder = { id: string; orderNo: string; contractDate: string; itemName: string; outstandingPaise: number };

/** Oldest-first split of `amountPaise` over `orders` (last order may get a part payment). */
export function autoSplit(amountPaise: number, orders: { id: string; outstandingPaise: number }[]) {
  let left = amountPaise;
  const out: Record<string, number> = {};
  for (const o of orders) {
    if (left <= 0) break;
    const take = Math.min(left, o.outstandingPaise);
    out[o.id] = take;
    left -= take;
  }
  return { split: out, remainder: left };
}

interface Props {
  institute: string;
  receipts: CashReceipt[];
  onAccountPaise: number;
  canAllocate: boolean;
  onChanged: () => void;
}

export default function OnAccountPanel({ institute, receipts, onAccountPaise, canAllocate, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setAmounts({});
    cbFetch<{ orders: PendingOrder[] }>(`/api/cashbook/order-payments/pending-orders?institute=${encodeURIComponent(institute)}`)
      .then((d) => setOrders(d.orders))
      .catch((e) => setError(e.message));
  }, [open, institute]);

  if (receipts.length === 0 && onAccountPaise === 0) return null;

  const rupeeToPaise = (s: string) => {
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec((s || "").trim());
    return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0) : 0;
  };
  const used = Object.values(amounts).reduce((s, v) => s + rupeeToPaise(v), 0);

  const auto = () => {
    const { split } = autoSplit(onAccountPaise, orders);
    setAmounts(Object.fromEntries(Object.entries(split).map(([id, p]) => [id, String(p / 100)])));
  };

  const submit = async () => {
    try {
      setBusy(true);
      setError("");
      const allocations = Object.entries(amounts).filter(([, v]) => rupeeToPaise(v) > 0).map(([orderId, amount]) => ({ orderId, amount }));
      await cbFetch("/api/cashbook/order-payments/allocate", { method: "POST", json: { institute, allocations } });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-emerald-200 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Cash receipts (Cashbook)</h4>
        {onAccountPaise > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold text-amber-700">On account {fmtPaise(onAccountPaise)} — order se jodna baaki</span>
            {canAllocate && (
              <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold">Order se jodo</button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-400 text-left">
            <tr><th className="py-1">Date</th><th>Received</th><th>Orders mein</th><th>On account</th><th>Deduction</th><th>Status</th></tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.status === "PENDING" ? "bg-amber-50" : ""}`}>
                <td className="py-1.5">{r.date}</td>
                <td className="font-bold">{fmtPaise(r.amountPaise)}</td>
                <td>{r.allocations.length ? r.allocations.map((a) => `${a.orderNo} ${fmtPaise(a.amountPaise)}`).join(", ") : "-"}</td>
                <td>{r.onAccountPaise ? `${fmtPaise(r.onAccountPaise)}${r.onAccountRemainingPaise !== r.onAccountPaise ? ` (baaki ${fmtPaise(r.onAccountRemainingPaise)})` : ""}` : "-"}</td>
                <td>{r.deductionPaise ? `${r.deductionType} ${fmtPaise(r.deductionPaise)}` : "-"}</td>
                <td>{r.status === "PENDING" ? "Approval pending" : "Approved"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black uppercase text-sm">Order se jodo — {institute}</h3>
            <p className="text-xs text-slate-500">On account: <b>{fmtPaise(onAccountPaise)}</b>. Isse koi nayi cashbook entry nahi banti, sirf orders update hote hain.</p>
            <button onClick={auto} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-900 text-white">Auto baanto</button>
            <div className="space-y-1.5">
              {orders.length === 0 && <p className="text-sm text-slate-400">Koi pending order nahi</p>}
              {orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-semibold">{o.orderNo}</p>
                    <p className="text-[11px] text-slate-400">{o.contractDate} · baaki {fmtPaise(o.outstandingPaise)}</p>
                  </div>
                  <input inputMode="decimal" value={amounts[o.id] || ""} onChange={(e) => setAmounts((a) => ({ ...a, [o.id]: e.target.value }))} placeholder="₹" className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-right" />
                </div>
              ))}
            </div>
            <p className={`text-xs font-bold ${used > onAccountPaise ? "text-red-600" : "text-slate-600"}`}>Jodna hai {fmtPaise(used)} / on account {fmtPaise(onAccountPaise)}</p>
            {error && <div className="p-2 rounded-lg bg-red-50 text-red-600 text-xs">{error}</div>}
            <div className="flex gap-2">
              <button disabled={busy || used <= 0 || used > onAccountPaise} onClick={submit} className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">{busy ? "Wait..." : "Jodo"}</button>
              <button onClick={() => setOpen(false)} className="px-4 rounded-lg border border-slate-300 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
