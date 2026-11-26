"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { FiArrowLeft, FiChevronLeft, FiChevronRight, FiDownload, FiPlus, FiMinus, FiEdit2, FiTrash2, FiPaperclip, FiSettings } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { cbFetch, fmtDateNice, fmtPaise, fmtTime, shiftDate, todayIST, useOmsUser } from "@/lib/cashbook/client";

type Entry = {
  id: string; date: string; createdAt: string; direction: "IN" | "OUT"; type: string; amountPaise: number; mode: string;
  accountId: string | null; categoryName: string; particulars: string; remark: string; hasAttachment: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED"; rejectReason: string; enteredBy: string; staff: string; paidFrom: string;
  institute: string; onAccountPaise: number; deductionPaise: number; deductionType: string | null;
  allocations: { orderId: string; orderNo: string; amountPaise: number }[];
};
type Breakup = { cash: number; banks: { id: string; name: string; paise: number }[]; staff: number; total: number };
type Day = {
  seeAll: boolean; entries: Entry[];
  cards?: { opening: Breakup; closing: Breakup; totalIn: number; totalOut: number };
  pending: { count: number; totalPaise: number; canApprove: boolean };
};

const FILTERS = ["All", "Cash", "Bank", "UPI", "Pending only"] as const;
const noAccess = (
  <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
    <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
    <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg">Go to Dashboard</Link>
  </div>
);

function BreakupLines({ b }: { b: Breakup }) {
  return (
    <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
      <div className="flex justify-between"><span>Cash in hand</span><span>{fmtPaise(b.cash)}</span></div>
      {b.banks.map((x) => (
        <div key={x.id} className="flex justify-between"><span>{x.name}</span><span>{fmtPaise(x.paise)}</span></div>
      ))}
      <div className="flex justify-between"><span>Staff ke paas</span><span>{fmtPaise(b.staff)}</span></div>
    </div>
  );
}

export default function CashbookDayPage() {
  const { can } = useOmsUser();
  const [date, setDate] = useState(todayIST());
  const [data, setData] = useState<Day | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await cbFetch<Day>(`/api/cashbook/day?date=${date}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.entries || []).filter((e) => {
      if (filter === "Cash" && e.mode !== "CASH") return false;
      if (filter === "Bank" && e.mode !== "BANK") return false;
      if (filter === "UPI" && e.mode !== "UPI") return false;
      if (filter === "Pending only" && e.status !== "PENDING") return false;
      if (s && !`${e.particulars} ${e.categoryName} ${e.enteredBy} ${e.remark}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [data, filter, q]);

  const exportExcel = () => {
    const sheet = rows.map((e) => ({
      Date: e.date, Time: fmtTime(e.createdAt), Particulars: e.particulars, Category: e.categoryName, Mode: e.mode,
      "Entered by": e.enteredBy, In: e.direction === "IN" ? e.amountPaise / 100 : "", Out: e.direction === "OUT" ? e.amountPaise / 100 : "",
      Status: e.status, Remark: e.remark,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Cashbook");
    XLSX.writeFile(wb, `Cashbook_${date}.xlsx`);
  };

  const act = async (fn: () => Promise<any>) => {
    try { await fn(); await load(); } catch (e: any) { alert(e.message); }
  };
  const remove = (e: Entry) => {
    const msg = e.type === "ORDER_PAYMENT_CASH" && e.status === "APPROVED"
      ? "Yeh cash payment delete karne par cashbook, orders, ledger aur pending/received sab pehle jaisa ho jayega. Pakka?"
      : "Yeh entry delete karni hai?";
    if (confirm(msg)) act(() => cbFetch(`/api/cashbook/entries/${e.id}`, { method: "DELETE" }));
  };
  const viewBill = (e: Entry) =>
    act(async () => { const r = await cbFetch<{ url: string }>(`/api/cashbook/entries/${e.id}/attachment`); window.open(r.url, "_blank"); });

  const c = data?.cards;
  const card = "bg-white border border-slate-200 rounded-2xl p-4 shadow-sm";

  return (
    <BlockGuard permission="cashbookView" fallback={noAccess}>
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-7xl mx-auto flex flex-col gap-4">
          <div>
            <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 w-fit"><FiArrowLeft /> Back to Account</Link>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Cashbook</h1>
              <div className="flex flex-wrap gap-2">
                {can("cashbookMasters") && (
                  <Link href="/dashboard/account/cashbook/masters" className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white"><FiSettings /> Masters</Link>
                )}
                <Link href="/dashboard/account/cashbook/advance" className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white">Staff Advance</Link>
                {can("cashbookReports") && (
                  <Link href="/dashboard/account/cashbook/reports" className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white">Reports</Link>
                )}
                <button onClick={exportExcel} className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white"><FiDownload /> Export Excel</button>
                {can("cashbookOrderPayment") && (
                  <Link href="/dashboard/account/cashbook/order-payment" className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-emerald-700 text-white">Cash payment received</Link>
                )}
                {can("cashbookEntry") && (
                  <>
                    <Link href="/dashboard/account/cashbook/new?dir=IN" className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-green-600 text-white"><FiPlus /> Cash In</Link>
                    <Link href="/dashboard/account/cashbook/new?dir=OUT" className="flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-red-600 text-white"><FiMinus /> Cash Out</Link>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setDate(shiftDate(date, -1))} className="p-2 rounded-lg border border-slate-300 bg-white"><FiChevronLeft /></button>
            <input type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={() => setDate(shiftDate(date, 1))} disabled={date >= todayIST()} className="p-2 rounded-lg border border-slate-300 bg-white disabled:opacity-40"><FiChevronRight /></button>
            <span className="text-sm text-slate-500 hidden sm:inline">{fmtDateNice(date)}</span>
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          {c && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className={card}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Opening balance</p>
                <p className="text-xl font-black text-slate-900">{fmtPaise(c.opening.total)}</p>
                <BreakupLines b={c.opening} />
              </div>
              <div className={card}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Total In</p>
                <p className="text-xl font-black text-green-600">{fmtPaise(c.totalIn)}</p>
                <p className="mt-2 text-[11px] text-slate-400">Transfer (advance) shamil nahi</p>
              </div>
              <div className={card}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Total Out</p>
                <p className="text-xl font-black text-red-600">{fmtPaise(c.totalOut)}</p>
                <p className="mt-2 text-[11px] text-slate-400">Transfer (advance) shamil nahi</p>
              </div>
              <div className={card}>
                <p className="text-[10px] font-bold uppercase text-slate-400">Closing balance</p>
                <p className="text-xl font-black text-slate-900">{fmtPaise(c.closing.total)}</p>
                <BreakupLines b={c.closing} />
              </div>
            </div>
          )}

          {data && data.pending.count > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <span><b>{data.pending.count}</b> entries approval pending ({fmtPaise(data.pending.totalPaise)}), jab tak approve nahi hoti balance mein nahi judti</span>
              {data.pending.canApprove && <Link href="/dashboard/account/cashbook/approvals" className="font-bold underline">Approvals kholo →</Link>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`text-xs font-bold px-3 py-1.5 rounded-full border ${filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"}`}>{f}</button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search particulars / category / staff" className="ml-auto border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full sm:w-72" />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="text-left p-3">Time</th><th className="text-left p-3">Particulars</th><th className="text-left p-3">Mode</th>
                  <th className="text-left p-3">Entered by</th><th className="text-right p-3">In</th><th className="text-right p-3">Out</th>
                  <th className="text-left p-3">Status</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">{data ? "Is din koi entry nahi" : "Loading..."}</td></tr>}
                {rows.map((e) => {
                  // Buttons are shown by permission only; the API enforces ownership/status rules.
                  const canModify = e.status === "APPROVED" ? can("cashbookEditApproved") : can("cashbookEntry") || can("cashbookEditApproved");
                  return (
                    <tr key={e.id} className={`border-t border-slate-100 ${e.status === "PENDING" ? "bg-amber-50" : e.status === "REJECTED" ? "bg-red-50" : ""}`}>
                      <td className="p-3 whitespace-nowrap text-slate-500">{fmtTime(e.createdAt)}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">{e.particulars}</div>
                        <div className="text-[11px] text-slate-400">
                          {e.type === "ADVANCE_TOPUP" || e.type === "ADVANCE_RETURN" ? (
                            <span className="font-bold text-indigo-600 mr-1">Transfer</span>
                          ) : e.paidFrom === "STAFF_ADVANCE" ? (
                            <span className="font-bold text-indigo-600 mr-1">Advance se ({e.staff})</span>
                          ) : null}
                          {e.categoryName}{e.remark ? ` · ${e.remark}` : ""}
                        </div>
                        {e.type === "ORDER_PAYMENT_CASH" && (
                          <div className="text-[11px] text-emerald-700">
                            {e.allocations.length > 0 && <>Orders: {e.allocations.map((a) => `${a.orderNo} ${fmtPaise(a.amountPaise)}`).join(", ")}. </>}
                            {e.onAccountPaise > 0 && <>On account {fmtPaise(e.onAccountPaise)}. </>}
                            {e.deductionPaise > 0 && <>{e.deductionType} {fmtPaise(e.deductionPaise)}.</>}
                          </div>
                        )}
                        {e.status === "REJECTED" && <div className="text-[11px] text-red-600">Reject: {e.rejectReason}</div>}
                      </td>
                      <td className="p-3 text-xs">{e.mode}</td>
                      <td className="p-3 text-xs">{e.enteredBy}</td>
                      <td className="p-3 text-right font-bold text-green-600 whitespace-nowrap">{e.direction === "IN" ? fmtPaise(e.amountPaise) : ""}</td>
                      <td className="p-3 text-right font-bold text-red-600 whitespace-nowrap">{e.direction === "OUT" ? fmtPaise(e.amountPaise) : ""}</td>
                      <td className="p-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${e.status === "APPROVED" ? "bg-green-100 text-green-700" : e.status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{e.status}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap text-right">
                        {e.hasAttachment && <button onClick={() => viewBill(e)} title="Bill dekho" className="p-1.5 text-slate-500"><FiPaperclip /></button>}
                        {(e.type === "ADVANCE_TOPUP" || e.type === "ADVANCE_RETURN") && can("cashbookAdvance") && (
                          <button onClick={() => remove(e)} className="p-1.5 text-red-600"><FiTrash2 /></button>
                        )}
                        {e.type === "ORDER_PAYMENT_CASH" && (e.status === "APPROVED" ? can("cashbookEditApproved") : can("cashbookOrderPayment") || can("cashbookEditApproved")) && (
                          <>
                            <Link href={`/dashboard/account/cashbook/order-payment?edit=${e.id}`} className="inline-block p-1.5 text-blue-600"><FiEdit2 /></Link>
                            <button onClick={() => remove(e)} className="p-1.5 text-red-600"><FiTrash2 /></button>
                          </>
                        )}
                        {canModify && e.type === "NORMAL" && (
                          <>
                            <Link href={`/dashboard/account/cashbook/new?edit=${e.id}`} className="inline-block p-1.5 text-blue-600"><FiEdit2 /></Link>
                            <button onClick={() => remove(e)} className="p-1.5 text-red-600"><FiTrash2 /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
