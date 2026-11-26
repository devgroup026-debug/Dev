"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiArrowLeft } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { cbFetch, fmtPaise, todayIST } from "@/lib/cashbook/client";

type Account = { id: string; name: string; type: "CASH" | "BANK"; firmCode: string; openingPaise: number; openingDate: string; active: boolean };
type Category = { id: string; name: string; direction: "IN" | "OUT" | "BOTH"; system: boolean; active: boolean };

const noAccess = (
  <div className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center text-red-500 font-bold uppercase">You have no Access for this Page.</div>
);
const input = "border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white";

export default function MastersPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [error, setError] = useState("");

  const [aName, setAName] = useState("");
  const [aType, setAType] = useState<"CASH" | "BANK">("BANK");
  const [aOpening, setAOpening] = useState("0");
  const [aDate, setADate] = useState(todayIST());
  const [aFirm, setAFirm] = useState("");
  const [cName, setCName] = useState("");
  const [cDir, setCDir] = useState<"IN" | "OUT" | "BOTH">("OUT");

  const load = useCallback(async () => {
    try {
      setError("");
      const [a, c] = await Promise.all([cbFetch<Account[]>("/api/cashbook/accounts"), cbFetch<Category[]>("/api/cashbook/categories")]);
      setAccounts(a); setCats(c);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>) => {
    try { await fn(); await load(); } catch (e: any) { alert(e.message); }
  };
  const addAccount = (ev: React.FormEvent) => {
    ev.preventDefault();
    run(async () => {
      await cbFetch("/api/cashbook/accounts", { method: "POST", json: { name: aName, type: aType, opening: aOpening, openingDate: aDate, firmCode: aFirm } });
      setAName(""); setAOpening("0"); setAFirm("");
    });
  };
  const addCategory = (ev: React.FormEvent) => {
    ev.preventDefault();
    run(async () => { await cbFetch("/api/cashbook/categories", { method: "POST", json: { name: cName, direction: cDir } }); setCName(""); });
  };
  const editAccount = (a: Account) => {
    const name = prompt("Account ka naam", a.name);
    if (name === null) return;
    const opening = prompt("Opening balance (₹)", String(a.openingPaise / 100));
    if (opening === null) return;
    run(() => cbFetch("/api/cashbook/accounts", { method: "PUT", json: { id: a.id, name, opening } }));
  };
  const renameCategory = (c: Category) => {
    const name = prompt("Category ka naam", c.name);
    if (name === null) return;
    run(() => cbFetch("/api/cashbook/categories", { method: "PUT", json: { id: c.id, name } }));
  };

  const card = "bg-white border border-slate-200 rounded-2xl p-4";
  return (
    <BlockGuard permission="cashbookMasters" fallback={noAccess}>
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <Link href="/dashboard/account/cashbook" className="flex items-center gap-2 text-slate-500 text-xs w-fit"><FiArrowLeft /> Cashbook</Link>
          <h1 className="text-xl font-black uppercase text-slate-900">Accounts & Categories</h1>
          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          <section className={card}>
            <h2 className="font-black uppercase text-sm mb-3">Accounts</h2>
            <p className="text-xs text-slate-500 mb-3">UPI koi account nahi hai, wo payment mode hai. UPI entry mein bank account chuna jata hai.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-slate-500 text-left"><tr><th className="py-2">Naam</th><th>Type</th><th>Firm</th><th className="text-right">Opening</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className={`border-t border-slate-100 ${a.active ? "" : "opacity-50"}`}>
                      <td className="py-2 font-semibold">{a.name}</td><td>{a.type}</td><td>{a.firmCode || "-"}</td>
                      <td className="text-right">{fmtPaise(a.openingPaise)}</td><td>{a.openingDate}</td>
                      <td className="text-right whitespace-nowrap">
                        <button onClick={() => editAccount(a)} className="text-blue-600 text-xs font-bold mr-3">Edit</button>
                        <button onClick={() => run(() => cbFetch("/api/cashbook/accounts", { method: "PUT", json: { id: a.id, active: !a.active } }))} className="text-xs font-bold text-slate-600">{a.active ? "Band karo" : "Chalu karo"}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form onSubmit={addAccount} className="mt-4 flex flex-wrap gap-2 items-end">
              <input required value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Account ka naam" className={input} />
              <select value={aType} onChange={(e) => setAType(e.target.value as any)} className={input}><option value="BANK">BANK</option><option value="CASH">CASH</option></select>
              <input value={aFirm} onChange={(e) => setAFirm(e.target.value)} placeholder="Firm code (optional)" className={`${input} w-40`} />
              <input value={aOpening} onChange={(e) => setAOpening(e.target.value)} placeholder="Opening ₹" className={`${input} w-32`} />
              <input type="date" value={aDate} onChange={(e) => setADate(e.target.value)} className={input} />
              <button className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold">+ Account</button>
            </form>
          </section>

          <section className={card}>
            <h2 className="font-black uppercase text-sm mb-3">Categories</h2>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <div key={c.id} className={`flex items-center gap-2 border rounded-full px-3 py-1 text-xs ${c.active ? "bg-white border-slate-300" : "bg-slate-100 text-slate-400 border-slate-200"}`}>
                  <span className="font-semibold">{c.name}</span><span className="text-[10px] text-slate-400">{c.direction}</span>
                  {!c.system && (
                    <>
                      <button onClick={() => renameCategory(c)} className="text-blue-600 font-bold">edit</button>
                      <button onClick={() => run(() => cbFetch("/api/cashbook/categories", { method: "PUT", json: { id: c.id, active: !c.active } }))} className="text-slate-500 font-bold">{c.active ? "band" : "chalu"}</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <form onSubmit={addCategory} className="mt-4 flex flex-wrap gap-2">
              <input required value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Nayi category" className={input} />
              <select value={cDir} onChange={(e) => setCDir(e.target.value as any)} className={input}><option value="OUT">Cash Out</option><option value="IN">Cash In</option><option value="BOTH">Dono</option></select>
              <button className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold">+ Category</button>
            </form>
          </section>
        </div>
      </div>
    </BlockGuard>
  );
}
