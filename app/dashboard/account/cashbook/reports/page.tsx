"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { FiArrowLeft, FiDownload } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { cbFetch, fmtPaise, todayIST } from "@/lib/cashbook/client";

type Tab = "statement" | "account" | "category" | "staff";
type Account = { id: string; name: string; type: string };

const noAccess = (
  <div className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center text-red-500 font-bold uppercase">You have no Access for this Page.</div>
);
const TABS: { key: Tab; label: string }[] = [
  { key: "statement", label: "Date-range Cashbook" },
  { key: "account", label: "Account-wise" },
  { key: "category", label: "Category-wise" },
  { key: "staff", label: "Staff Advance" },
];
const rs = (p: number) => p / 100;
const typeLabel = (t: string) =>
  t === "ADVANCE_TOPUP" ? "Advance top-up" : t === "ADVANCE_RETURN" ? "Advance wapas" : t === "ORDER_PAYMENT_CASH" ? "Cash payment received" : t === "OPENING" ? "Opening" : "Entry";

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("statement");
  const [from, setFrom] = useState(() => todayIST().slice(0, 8) + "01");
  const [to, setTo] = useState(todayIST());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [staff, setStaff] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    cbFetch<Account[]>("/api/cashbook/accounts").then((a) => {
      setAccounts(a);
      setAccount((cur) => cur || a[0]?.id || "");
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (tab === "account" && !account) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ from, to });
      if (tab === "statement") q.set("type", "statement");
      if (tab === "account") { q.set("type", "statement"); q.set("account", account); }
      if (tab === "category") q.set("type", "category");
      if (tab === "staff") { q.set("type", "staff"); if (staff) q.set("staff", staff); }
      setData(await cbFetch(`/api/cashbook/reports?${q}`));
    } catch (e: any) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab, from, to, account, staff]);
  useEffect(() => { load(); }, [load]);

  const switchTab = (t: Tab) => { setTab(t); setData(null); if (t !== "staff") setStaff(""); };

  // ------------------------------------------------------------ Excel
  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    let name = "Report";
    let aoa: any[][] = [];
    if (data.type === "statement") {
      name = data.account ? `Statement_${data.account.name}` : "Cashbook";
      aoa = [
        [data.account ? `Account statement — ${data.account.name}` : "Cashbook (all accounts)"],
        [`${from} to ${to}`],
        [],
        ["Date", "Account", "Particulars", "Category", "Type", "Mode", "Entered by", "In", "Out", "Balance", "Remark"],
        ["", "", "Opening balance", "", "", "", "", "", "", rs(data.openingPaise), ""],
        ...data.rows.map((r: any) => [
          r.date, r.accountName, r.particulars, r.categoryName, typeLabel(r.type), r.mode, r.enteredBy,
          r.direction === "IN" ? rs(r.amountPaise) : "", r.direction === "OUT" ? rs(r.amountPaise) : "", rs(r.runningPaise), r.remark,
        ]),
        [],
        ["", "", "Total In / Out (transfers chhodke)", "", "", "", "", rs(data.totalIn), rs(data.totalOut), "", ""],
        ["", "", "Closing balance", "", "", "", "", "", "", rs(data.closingPaise), ""],
      ];
    } else if (data.type === "category") {
      name = "Category-wise";
      aoa = [
        ["Category-wise summary"], [`${from} to ${to}`], [],
        ["Category", "Entries", "In", "Out", "Net"],
        ...data.rows.map((r: any) => [r.category, r.count, rs(r.inPaise), rs(r.outPaise), rs(r.inPaise - r.outPaise)]),
        [],
        ["Total", "", rs(data.totalIn), rs(data.totalOut), rs(data.totalIn - data.totalOut)],
      ];
    } else if (data.staff) {
      name = `Advance_${data.staff}`;
      aoa = [
        [`Staff advance statement — ${data.staff}`], [`${from} to ${to}`], [],
        ["Date", "Particulars", "Type", "Top-up / Return", "Kharcha", "Balance"],
        ["", "Opening balance", "", "", "", rs(data.openingPaise)],
        ...data.rows.map((r: any) => [
          r.date, r.particulars, typeLabel(r.type),
          r.type === "ADVANCE_TOPUP" ? rs(r.amountPaise) : r.type === "ADVANCE_RETURN" ? -rs(r.amountPaise) : "",
          r.type === "NORMAL" ? rs(r.amountPaise) : "", rs(r.runningPaise),
        ]),
        [], ["Closing balance", "", "", "", "", rs(data.closingPaise)],
      ];
    } else {
      name = "Staff_Advance";
      aoa = [
        ["Staff advance — all staff"], [`${from} to ${to}`], [],
        ["Staff", "Opening", "Top-up", "Wapas", "Kharcha", "Closing"],
        ...data.rows.map((r: any) => [r.staff, rs(r.openingPaise), rs(r.topupPaise), rs(r.returnPaise), rs(r.spentPaise), rs(r.closingPaise)]),
      ];
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = aoa[3]?.map(() => ({ wch: 18 })) || [];
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, "").slice(0, 31));
    XLSX.writeFile(wb, `Cashbook_${name.replace(/[^\w-]+/g, "_")}_${from}_${to}.xlsx`);
  };

  const th = "py-2 px-2 text-left text-[10px] uppercase text-slate-400 font-bold";
  const td = "py-2 px-2";
  const num = "py-2 px-2 text-right whitespace-nowrap";

  return (
    <BlockGuard permission="cashbookReports" fallback={noAccess}>
      <div className="p-4 bg-slate-50 min-h-screen">
        <div className="max-w-5xl mx-auto flex flex-col gap-4">
          <Link href="/dashboard/account/cashbook" className="flex items-center gap-2 text-slate-500 text-xs w-fit"><FiArrowLeft /> Cashbook</Link>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">Cashbook Reports</h1>

          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => switchTab(t.key)} className={`px-4 py-2 rounded-lg text-xs font-bold border ${tab === t.key ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 text-slate-600"}`}>{t.label}</button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-end gap-3">
            <label className="text-xs font-bold text-slate-500 flex flex-col gap-1">From
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-normal text-slate-900" />
            </label>
            <label className="text-xs font-bold text-slate-500 flex flex-col gap-1">To
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-normal text-slate-900" />
            </label>
            {tab === "account" && (
              <label className="text-xs font-bold text-slate-500 flex flex-col gap-1">Account
                <select value={account} onChange={(e) => setAccount(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-normal text-slate-900">
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </select>
              </label>
            )}
            {tab === "staff" && staff && (
              <button onClick={() => setStaff("")} className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white">← Sab staff</button>
            )}
            <button onClick={exportExcel} disabled={!data || loading} className="ml-auto flex items-center gap-1 text-xs font-bold px-4 py-2.5 rounded-lg bg-emerald-700 text-white disabled:opacity-40"><FiDownload /> Export Excel</button>
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
          {loading && !data && <div className="p-8 text-center text-slate-400">Loading...</div>}

          {data?.type === "statement" && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 text-sm">
                {[["Opening", data.openingPaise], ["Total In", data.totalIn], ["Total Out", data.totalOut], ["Closing", data.closingPaise]].map(([l, v]: any) => (
                  <div key={l} className="bg-white p-3"><p className="text-[10px] uppercase font-bold text-slate-400">{l}</p><p className="font-black text-slate-900">{fmtPaise(v)}</p></div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr><th className={th}>Date</th><th className={th}>Particulars</th><th className={th}>Category</th>{!data.account && <th className={th}>Account</th>}<th className={`${th} text-right`}>In</th><th className={`${th} text-right`}>Out</th><th className={`${th} text-right`}>Balance</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-slate-100 bg-slate-50 font-bold"><td className={td} colSpan={data.account ? 6 : 7}>Opening balance</td><td className={num}>{fmtPaise(data.openingPaise)}</td></tr>
                    {data.rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">Is period mein koi approved entry nahi</td></tr>}
                    {data.rows.map((r: any) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                        <td className={td}>{r.particulars}{r.type !== "NORMAL" && r.type !== "OPENING" && <span className="ml-1 text-[10px] text-slate-400">({typeLabel(r.type)})</span>}</td>
                        <td className={td}>{r.categoryName}</td>
                        {!data.account && <td className={td}>{r.accountName}</td>}
                        <td className={`${num} text-green-600`}>{r.direction === "IN" ? fmtPaise(r.amountPaise) : ""}</td>
                        <td className={`${num} text-red-600`}>{r.direction === "OUT" ? fmtPaise(r.amountPaise) : ""}</td>
                        <td className={`${num} font-bold`}>{fmtPaise(r.runningPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p-3 text-[11px] text-slate-400">Sirf approved entries. Total In/Out mein advance top-up/wapas shamil nahi (wo sirf account ke beech transfer hain). Staff advance se hue kharche account balance par asar nahi daalte.</p>
            </div>
          )}

          {data?.type === "category" && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Category</th><th className={`${th} text-right`}>Entries</th><th className={`${th} text-right`}>In</th><th className={`${th} text-right`}>Out</th><th className={`${th} text-right`}>Net</th></tr></thead>
                <tbody>
                  {data.rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Is period mein koi approved entry nahi</td></tr>}
                  {data.rows.map((r: any) => (
                    <tr key={r.category} className="border-t border-slate-100">
                      <td className={td}>{r.category}</td><td className={num}>{r.count}</td>
                      <td className={`${num} text-green-600`}>{r.inPaise ? fmtPaise(r.inPaise) : ""}</td>
                      <td className={`${num} text-red-600`}>{r.outPaise ? fmtPaise(r.outPaise) : ""}</td>
                      <td className={`${num} font-bold`}>{fmtPaise(r.inPaise - r.outPaise)}</td>
                    </tr>
                  ))}
                  {data.rows.length > 0 && (
                    <tr className="border-t-2 border-slate-300 font-black bg-slate-50">
                      <td className={td}>Total</td><td className={num}></td>
                      <td className={`${num} text-green-600`}>{fmtPaise(data.totalIn)}</td><td className={`${num} text-red-600`}>{fmtPaise(data.totalOut)}</td>
                      <td className={num}>{fmtPaise(data.totalIn - data.totalOut)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {data?.type === "staff" && !data.staff && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Staff</th><th className={`${th} text-right`}>Opening</th><th className={`${th} text-right`}>Top-up</th><th className={`${th} text-right`}>Wapas</th><th className={`${th} text-right`}>Kharcha</th><th className={`${th} text-right`}>Closing</th></tr></thead>
                <tbody>
                  {data.rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">Is period mein koi advance activity nahi</td></tr>}
                  {data.rows.map((r: any) => (
                    <tr key={r.staff} onClick={() => setStaff(r.staff)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50">
                      <td className={`${td} font-bold`}>{r.staff}</td>
                      <td className={num}>{fmtPaise(r.openingPaise)}</td><td className={num}>{fmtPaise(r.topupPaise)}</td>
                      <td className={num}>{fmtPaise(r.returnPaise)}</td><td className={num}>{fmtPaise(r.spentPaise)}</td>
                      <td className={`${num} font-black ${r.closingPaise < 0 ? "text-red-600" : ""}`}>{fmtPaise(r.closingPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-3 text-[11px] text-slate-400">Kisi staff par click karo to uska day-wise statement khulega. Negative closing = staff ko paise dene baaki.</p>
            </div>
          )}

          {data?.type === "staff" && data.staff && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="p-3 font-black uppercase text-sm border-b border-slate-100">{data.staff}</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 text-sm">
                {[["Opening", data.openingPaise], ["Top-up", data.topupPaise], ["Wapas", data.returnPaise], ["Kharcha", data.spentPaise], ["Closing", data.closingPaise]].map(([l, v]: any) => (
                  <div key={l} className="bg-white p-3"><p className="text-[10px] uppercase font-bold text-slate-400">{l}</p><p className="font-black text-slate-900">{fmtPaise(v)}</p></div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr><th className={th}>Date</th><th className={th}>Particulars</th><th className={`${th} text-right`}>Top-up / Wapas</th><th className={`${th} text-right`}>Kharcha</th><th className={`${th} text-right`}>Balance</th></tr></thead>
                  <tbody>
                    {data.rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Is period mein koi activity nahi</td></tr>}
                    {data.rows.map((r: any) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                        <td className={td}>{r.particulars}<span className="ml-1 text-[10px] text-slate-400">({typeLabel(r.type)})</span></td>
                        <td className={`${num} text-green-600`}>{r.type === "ADVANCE_TOPUP" ? "+" + fmtPaise(r.amountPaise) : r.type === "ADVANCE_RETURN" ? "-" + fmtPaise(r.amountPaise) : ""}</td>
                        <td className={`${num} text-red-600`}>{r.type === "NORMAL" ? fmtPaise(r.amountPaise) : ""}</td>
                        <td className={`${num} font-bold`}>{fmtPaise(r.runningPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </BlockGuard>
  );
}
