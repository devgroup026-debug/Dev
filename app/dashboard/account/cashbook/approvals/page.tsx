"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiArrowLeft, FiCheck, FiX, FiPaperclip } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { cbFetch, fmtDateNice, fmtPaise, fmtTime } from "@/lib/cashbook/client";

type Entry = {
  id: string; date: string; createdAt: string; direction: "IN" | "OUT"; amountPaise: number; mode: string;
  categoryName: string; particulars: string; remark: string; hasAttachment: boolean; enteredBy: string;
  type: string; institute: string; onAccountPaise: number; deductionPaise: number; deductionType: string | null;
  allocations: { orderNo: string; amountPaise: number }[];
};
type Resp = { entries: Entry[]; count: number; totalPaise: number };

const noAccess = (
  <div className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center text-red-500 font-bold uppercase">You have no Access for this Page.</div>
);

export default function ApprovalsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await cbFetch<Resp>("/api/cashbook/entries?status=PENDING"));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); setRejecting(null); setReason(""); await load(); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };
  const approve = (id: string) => run(() => cbFetch(`/api/cashbook/entries/${id}/approve`, { method: "POST" }));
  const reject = (id: string) => {
    if (!reason.trim()) return alert("Reject karne ka reason likho");
    run(() => cbFetch(`/api/cashbook/entries/${id}/reject`, { method: "POST", json: { reason } }));
  };
  const approveAll = () => {
    if (!data?.count || !confirm(`Saari ${data.count} entries approve karni hain?`)) return;
    run(async () => {
      const r = await cbFetch<{ approved: number; failed: { particulars: string; error: string }[] }>("/api/cashbook/approve-all", {
        method: "POST",
        json: { ids: data.entries.map((e) => e.id) },
      });
      if (r.failed?.length) alert(`${r.approved} approve hui. In ${r.failed.length} mein dikkat:\n` + r.failed.map((f) => `${f.particulars}: ${f.error}`).join("\n"));
    });
  };
  const viewBill = (id: string) =>
    run(async () => { const r = await cbFetch<{ url: string }>(`/api/cashbook/entries/${id}/attachment`); window.open(r.url, "_blank"); });

  return (
    <BlockGuard permission="cashbookApprove" fallback={noAccess}>
      <div className="p-4 bg-slate-50 min-h-screen">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          <Link href="/dashboard/account/cashbook" className="flex items-center gap-2 text-slate-500 text-xs w-fit"><FiArrowLeft /> Cashbook</Link>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-black uppercase text-slate-900">Approvals</h1>
              {data && <p className="text-sm text-slate-500">{data.count} pending · {fmtPaise(data.totalPaise)}</p>}
            </div>
            <button onClick={approveAll} disabled={!data?.count || busy} className="px-4 py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold disabled:opacity-40">Approve all</button>
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
          {data && data.count === 0 && <div className="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">Koi entry pending nahi hai 🎉</div>}

          {data?.entries.map((e) => (
            <div key={e.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">{e.particulars}</p>
                  <p className="text-xs text-slate-500">{e.categoryName} · {e.mode} · {e.enteredBy}</p>
                  <p className="text-xs text-slate-400">{fmtDateNice(e.date)} · {fmtTime(e.createdAt)}</p>
                  {e.remark && <p className="text-xs text-slate-500 mt-1">{e.remark}</p>}
                  {e.type === "ORDER_PAYMENT_CASH" && (
                    <p className="text-xs text-emerald-700 mt-1">
                      Institute: {e.institute}.{" "}
                      {e.allocations.length > 0 && <>Orders: {e.allocations.map((a) => `${a.orderNo} ${fmtPaise(a.amountPaise)}`).join(", ")}. </>}
                      {e.onAccountPaise > 0 && <>On account {fmtPaise(e.onAccountPaise)}. </>}
                      {e.deductionPaise > 0 && <>{e.deductionType} {fmtPaise(e.deductionPaise)}.</>}
                    </p>
                  )}
                </div>
                <p className={`text-lg font-black whitespace-nowrap ${e.direction === "IN" ? "text-green-600" : "text-red-600"}`}>{e.direction === "IN" ? "+" : "-"}{fmtPaise(e.amountPaise)}</p>
              </div>
              {rejecting === e.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <input autoFocus value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Reject ka reason (zaroori)" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button onClick={() => reject(e.id)} disabled={busy} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-bold">Reject karo</button>
                    <button onClick={() => { setRejecting(null); setReason(""); }} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => approve(e.id)} disabled={busy} className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold"><FiCheck /> Approve</button>
                  <button onClick={() => setRejecting(e.id)} className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200 text-sm font-bold"><FiX /> Reject</button>
                  {e.hasAttachment && <button onClick={() => viewBill(e.id)} className="px-3 rounded-lg border border-slate-300 text-slate-600"><FiPaperclip /></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </BlockGuard>
  );
}
