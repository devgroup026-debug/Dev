"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiArrowLeft } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { cbFetch, fmtDateNice, fmtPaise, todayIST, useOmsUser } from "@/lib/cashbook/client";

type LEntry = { id: string; type: string; paidFrom: string; particulars: string; categoryName: string; remark: string; mode: string; amountPaise: number; delta: number; enteredBy: string };
type Ledger = {
  staff: string; balancePaise: number; pendingPaise: number; balanceAfterPendingPaise: number;
  pending: { id: string; date: string; particulars: string; categoryName: string; amountPaise: number }[];
  days: { date: string; carryForward: number; closing: number; entries: LEntry[] }[];
};
type Account = { id: string; name: string; type: "CASH" | "BANK"; active: boolean };

const noAccess = (
  <div className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center text-red-500 font-bold uppercase">You have no Access for this Page.</div>
);
const input = "w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base bg-white";

function typeLabel(e: LEntry) {
  if (e.type === "ADVANCE_TOPUP") return "Top-up mila";
  if (e.type === "ADVANCE_RETURN") return "Paise wapas diye";
  return "Kharcha";
}

export default function AdvancePage() {
  const { user, can } = useOmsUser();
  const manage = can("cashbookAdvance");
  const [staffList, setStaffList] = useState<{ username: string; balancePaise: number }[]>([]);
  const [staff, setStaff] = useState("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"TOPUP" | "RETURN" | null>(null);

  // form state
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"CASH" | "BANK" | "UPI">("CASH");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayIST());
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  // Managers pick a staff member; everyone else is fixed to themselves.
  useEffect(() => {
    if (!user) return;
    if (!manage) { setStaff(user.username); return; }
    cbFetch<typeof staffList>("/api/cashbook/advance/staff")
      .then((l) => { setStaffList(l); setStaff((s) => s || l.find((x) => x.balancePaise !== 0)?.username || l[0]?.username || ""); })
      .catch((e) => setError(e.message));
    cbFetch<Account[]>("/api/cashbook/accounts").then((a) => setAccounts(a.filter((x) => x.active))).catch(() => {});
  }, [user, manage]);

  const load = useCallback(async () => {
    if (!staff) return;
    try {
      setError("");
      setLedger(await cbFetch<Ledger>(`/api/cashbook/advance?staff=${encodeURIComponent(staff)}`));
    } catch (e: any) { setError(e.message); }
  }, [staff]);
  useEffect(() => { load(); }, [load]);

  const modeAccounts = accounts.filter((a) => a.type === (mode === "CASH" ? "CASH" : "BANK"));
  useEffect(() => {
    if (!modeAccounts.some((a) => a.id === accountId)) setAccountId(modeAccounts.length === 1 ? modeAccounts[0].id : "");
  }, [mode, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      setBusy(true);
      await cbFetch("/api/cashbook/advance", { method: "POST", json: { kind: modal, staff, amount, mode, accountId, date, remark } });
      setModal(null); setAmount(""); setRemark("");
      await load();
      if (manage) cbFetch<typeof staffList>("/api/cashbook/advance/staff").then(setStaffList).catch(() => {});
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const bal = ledger?.balancePaise ?? 0;
  const card = "bg-white border border-slate-200 rounded-2xl";

  return (
    <BlockGuard permission="cashbookView" fallback={noAccess}>
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <Link href="/dashboard/account/cashbook" className="flex items-center gap-2 text-slate-500 text-xs w-fit"><FiArrowLeft /> Cashbook</Link>
          <h1 className="text-xl font-black uppercase text-slate-900">Staff Advance</h1>

          {manage && (
            <select value={staff} onChange={(e) => setStaff(e.target.value)} className={input}>
              {staffList.map((s) => <option key={s.username} value={s.username}>{s.username}  ({fmtPaise(s.balancePaise)})</option>)}
            </select>
          )}

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          {ledger && (
            <>
              <div className={`${card} p-5`}>
                <p className="text-[10px] font-bold uppercase text-slate-400">{ledger.staff} ke paas advance</p>
                {bal < 0 ? (
                  <>
                    <p className="text-3xl font-black text-red-600">{fmtPaise(-bal)}</p>
                    <p className="text-sm font-bold text-red-600">Staff ko dena baaki</p>
                  </>
                ) : (
                  <p className="text-3xl font-black text-slate-900">{fmtPaise(bal)}</p>
                )}
                {ledger.pendingPaise > 0 && (
                  <p className="mt-2 text-sm text-amber-700">
                    {fmtPaise(ledger.pendingPaise)} approval pending, approve ke baad {ledger.balanceAfterPendingPaise < 0 ? `Staff ko dena baaki ${fmtPaise(-ledger.balanceAfterPendingPaise)}` : fmtPaise(ledger.balanceAfterPendingPaise)}
                  </p>
                )}
                {manage && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => setModal("TOPUP")} className="flex-1 py-2.5 rounded-lg bg-green-600 text-white text-sm font-bold">+ Top-up do</button>
                    <button onClick={() => setModal("RETURN")} className="flex-1 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-bold">Paise wapas lo</button>
                  </div>
                )}
              </div>

              {ledger.pending.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold uppercase text-amber-700 mb-2">Approval pending (balance mein nahi judi)</p>
                  {ledger.pending.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm py-1">
                      <span>{fmtDateNice(p.date)} · {p.particulars} <span className="text-slate-400">({p.categoryName})</span></span>
                      <span className="font-bold text-red-600">-{fmtPaise(p.amountPaise)}</span>
                    </div>
                  ))}
                </div>
              )}

              {ledger.days.length === 0 && <div className="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">Abhi koi advance entry nahi hai</div>}
              {ledger.days.map((d) => (
                <div key={d.date} className={`${card} overflow-hidden`}>
                  <div className="px-4 py-2 bg-slate-100 flex justify-between text-xs font-bold text-slate-600">
                    <span>{fmtDateNice(d.date)}</span>
                    <span>Carry forward {fmtPaise(d.carryForward)}</span>
                  </div>
                  {d.entries.map((e) => (
                    <div key={e.id} className="px-4 py-2.5 flex justify-between gap-3 border-t border-slate-100 text-sm">
                      <div>
                        <p className="font-semibold text-slate-800">{e.particulars}</p>
                        <p className="text-[11px] text-slate-400">{typeLabel(e)} · {e.categoryName}{e.remark ? ` · ${e.remark}` : ""}</p>
                      </div>
                      <span className={`font-bold whitespace-nowrap ${e.delta >= 0 ? "text-green-600" : "text-red-600"}`}>{e.delta >= 0 ? "+" : "-"}{fmtPaise(Math.abs(e.delta))}</span>
                    </div>
                  ))}
                  <div className="px-4 py-2 border-t border-slate-200 flex justify-between text-xs font-bold text-slate-700 bg-slate-50">
                    <span>Closing</span><span>{fmtPaise(d.closing)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {modal && (
          <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-4 z-50" onClick={() => setModal(null)}>
            <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-md flex flex-col gap-3">
              <h2 className="font-black uppercase">{modal === "TOPUP" ? `${staff} ko advance do` : `${staff} se paise wapas lo`}</h2>
              <input inputMode="decimal" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₹" className={`${input} text-xl font-black`} />
              <div className="grid grid-cols-3 gap-2">
                {(["CASH", "BANK", "UPI"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`py-2 rounded-lg text-sm font-bold border ${mode === m ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"}`}>{m}</button>
                ))}
              </div>
              <select required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
                <option value="">{modal === "TOPUP" ? "-- kahan se diya --" : "-- kahan jama hua --"}</option>
                {modeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input type="date" required value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className={input} />
              <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark (optional)" className={input} />
              <p className="text-xs text-slate-500">Yeh transfer hai: Total In/Out mein nahi judega.</p>
              <div className="flex gap-2">
                <button disabled={busy} className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-black uppercase disabled:opacity-50">{busy ? "Wait..." : "Save"}</button>
                <button type="button" onClick={() => setModal(null)} className="px-4 rounded-xl border border-slate-300">Cancel</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </BlockGuard>
  );
}
