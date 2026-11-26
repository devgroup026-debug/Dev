"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { cbFetch, todayIST, useOmsUser } from "@/lib/cashbook/client";

type Account = { id: string; name: string; type: "CASH" | "BANK"; active: boolean };
type Category = { id: string; name: string; direction: "IN" | "OUT" | "BOTH"; system: boolean; active: boolean };

const noAccess = (
  <div className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center text-red-500 font-bold uppercase">You have no Access for this Page.</div>
);

function EntryForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const editId = sp.get("edit");
  const { can } = useOmsUser();

  const [direction, setDirection] = useState<"IN" | "OUT">(sp.get("dir") === "IN" ? "IN" : "OUT");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"CASH" | "BANK" | "UPI">("CASH");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(todayIST());
  const [particulars, setParticulars] = useState("");
  const [remark, setRemark] = useState("");
  const [fromAdvance, setFromAdvance] = useState(false);
  const [attachmentKey, setAttachmentKey] = useState("");
  const [fileName, setFileName] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [a, c] = await Promise.all([cbFetch<Account[]>("/api/cashbook/accounts"), cbFetch<Category[]>("/api/cashbook/categories")]);
        setAccounts(a.filter((x) => x.active));
        setCategories(c.filter((x) => x.active && !x.system));
        if (editId) {
          const e = await cbFetch<any>(`/api/cashbook/entries/${editId}`);
          setDirection(e.direction); setAmount(String(e.amountPaise / 100)); setMode(e.mode); setAccountId(e.accountId || "");
          setFromAdvance(e.paidFrom === "STAFF_ADVANCE");
          setCategoryId(e.categoryId || ""); setDate(e.date); setParticulars(e.particulars); setRemark(e.remark || "");
          if (e.hasAttachment) setFileName("(pehle se bill laga hai)");
        }
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [editId]);

  const modeAccounts = useMemo(() => accounts.filter((a) => a.type === (mode === "CASH" ? "CASH" : "BANK")), [accounts, mode]);
  const cats = useMemo(() => categories.filter((c) => c.direction === "BOTH" || c.direction === direction), [categories, direction]);

  // Keep the selected account / category valid when mode or direction changes.
  useEffect(() => {
    if (!modeAccounts.some((a) => a.id === accountId)) setAccountId(modeAccounts.length === 1 ? modeAccounts[0].id : "");
  }, [modeAccounts, accountId]);
  useEffect(() => {
    if (categoryId && !cats.some((c) => c.id === categoryId)) setCategoryId("");
  }, [cats, categoryId]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBusy(true); setError("");
      const fd = new FormData();
      fd.append("file", file);
      const r = await cbFetch<{ key: string }>("/api/cashbook/upload", { method: "POST", body: fd });
      setAttachmentKey(r.key); setFileName(file.name);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      setBusy(true); setError("");
      const advance = fromAdvance && direction === "OUT";
      const payload = { direction, amount, mode, accountId, categoryId, date, particulars, remark, attachmentKey, paidFrom: advance ? "STAFF_ADVANCE" : "ACCOUNT" };
      if (editId) await cbFetch(`/api/cashbook/entries/${editId}`, { method: "PUT", json: payload });
      else await cbFetch("/api/cashbook/entries", { method: "POST", json: payload });
      router.push("/dashboard/account/cashbook");
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const auto = can("cashbookApprove");
  const input = "w-full border border-slate-300 rounded-lg px-3 py-3 text-base bg-white";
  const label = "block text-[11px] font-bold uppercase text-slate-500 mb-1";

  return (
    <div className="p-4 bg-slate-50 min-h-screen">
      <div className="max-w-lg mx-auto flex flex-col gap-4">
        <Link href="/dashboard/account/cashbook" className="flex items-center gap-2 text-slate-500 text-xs w-fit"><FiArrowLeft /> Cashbook</Link>
        <h1 className="text-xl font-black uppercase text-slate-900">{editId ? "Entry badlo" : "Nayi entry"}</h1>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDirection("IN")} className={`py-3 rounded-lg font-bold ${direction === "IN" ? "bg-green-600 text-white" : "bg-slate-100 text-slate-600"}`}>Cash In (aaya)</button>
            <button type="button" onClick={() => setDirection("OUT")} className={`py-3 rounded-lg font-bold ${direction === "OUT" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600"}`}>Cash Out (gaya)</button>
          </div>

          <div>
            <label className={label}>Amount (₹)</label>
            <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${input} text-2xl font-black`} />
          </div>

          {direction === "OUT" && (
            <div>
              <label className={label}>Paisa kahan se gaya</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setFromAdvance(false)} className={`py-2.5 rounded-lg text-sm font-bold border ${!fromAdvance ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"}`}>Main cash / bank se</button>
                <button type="button" onClick={() => setFromAdvance(true)} className={`py-2.5 rounded-lg text-sm font-bold border ${fromAdvance ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"}`}>Mere advance se</button>
              </div>
              {fromAdvance && <p className="text-xs text-slate-500 mt-1">Approve hone par aapke advance wallet se kategega, main cash/bank se nahi.</p>}
            </div>
          )}

          {!(fromAdvance && direction === "OUT") && (
          <>
          <div>
            <label className={label}>Payment mode</label>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "BANK", "UPI"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`py-2.5 rounded-lg text-sm font-bold border ${mode === m ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"}`}>{m === "CASH" ? "Cash" : m === "BANK" ? "Bank" : "UPI"}</button>
              ))}
            </div>
          </div>

          <div>
            <label className={label}>{mode === "CASH" ? "Account" : mode === "UPI" ? "Kis bank account se UPI hua" : "Bank account"}</label>
            <select required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
              <option value="">-- chuno --</option>
              {modeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {modeAccounts.length === 0 && <p className="text-xs text-red-500 mt-1">Is mode ka koi account nahi hai. Owner se Masters mein account banwao.</p>}
          </div>
          </>
          )}

          <div>
            <label className={label}>Category</label>
            <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
              <option value="">-- chuno --</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className={label}>Date</label>
            <input type="date" required value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Particulars</label>
            <input required value={particulars} onChange={(e) => setParticulars(e.target.value)} placeholder="Kis liye / kisko" className={input} />
          </div>

          <div>
            <label className={label}>Remark (optional)</label>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} className={input} />
          </div>

          <div>
            <label className={label}>Bill / receipt photo (optional)</label>
            <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => upload(e.target.files?.[0])} className="text-sm" />
            {fileName && <p className="text-xs text-slate-500 mt-1">{fileName}</p>}
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          <button disabled={busy} className="py-3.5 rounded-xl bg-slate-900 text-white font-black uppercase disabled:opacity-50">
            {busy ? "Please wait..." : auto ? "Save" : "Submit for approval"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function NewEntryPage() {
  return (
    <BlockGuard permission="cashbookEntry" fallback={noAccess}>
      <Suspense fallback={null}>
        <EntryForm />
      </Suspense>
    </BlockGuard>
  );
}
