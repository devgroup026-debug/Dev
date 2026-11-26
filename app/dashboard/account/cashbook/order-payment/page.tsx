"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { autoSplit } from "@/components/cashbook/OnAccountPanel";
import { cbFetch, fmtPaise, todayIST, useOmsUser } from "@/lib/cashbook/client";

type Institute = { name: string; pendingOrders: number; outstanding: number; onAccount: number };
type POrder = { id: string; orderNo: string; contractDate: string; itemName: string; outstandingPaise: number };
type Account = { id: string; name: string; type: "CASH" | "BANK"; active: boolean };

const noAccess = (
  <div className="m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center text-red-500 font-bold uppercase">You have no Access for this Page.</div>
);
const toPaise = (s: string) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec((s || "").trim().replace(/,/g, ""));
  return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0) : 0;
};

function Form() {
  const router = useRouter();
  const sp = useSearchParams();
  const editId = sp.get("edit");
  const { can } = useOmsUser();

  const [q, setQ] = useState("");
  const [list, setList] = useState<Institute[]>([]);
  const [institute, setInstitute] = useState("");
  const [orders, setOrders] = useState<POrder[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [existingOnAccount, setExistingOnAccount] = useState(0);
  const [amount, setAmount] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [deduction, setDeduction] = useState("");
  const [deductionType, setDeductionType] = useState("TDS");
  const [date, setDate] = useState(todayIST());
  const [remark, setRemark] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    cbFetch<Account[]>("/api/cashbook/accounts")
      .then((a) => {
        const cash = a.filter((x) => x.active && x.type === "CASH");
        setAccounts(cash);
        setAccountId((cur) => cur || cash[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  // Institute search (only while none is chosen)
  useEffect(() => {
    if (institute) return;
    const t = setTimeout(() => {
      cbFetch<Institute[]>(`/api/cashbook/order-payments/institutes?q=${encodeURIComponent(q)}`).then(setList).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, institute]);

  // Editing: load the existing receipt
  useEffect(() => {
    if (!editId) return;
    cbFetch<any>(`/api/cashbook/entries/${editId}`)
      .then((e) => {
        setInstitute(e.institute);
        setAmount(String(e.amountPaise / 100));
        setDate(e.date);
        setRemark(e.remark || "");
        if (e.accountId) setAccountId(e.accountId);
        setAlloc(Object.fromEntries(e.allocations.map((a: any) => [a.orderId, String(a.amountPaise / 100)])));
        if (e.deductionPaise) { setDeduction(String(e.deductionPaise / 100)); setDeductionType(e.deductionType || "TDS"); }
      })
      .catch((e) => setError(e.message));
  }, [editId]);

  // Pending orders for the chosen institute
  useEffect(() => {
    if (!institute) return;
    cbFetch<{ orders: POrder[]; totalOutstandingPaise: number; onAccountPaise: number }>(
      `/api/cashbook/order-payments/pending-orders?institute=${encodeURIComponent(institute)}${editId ? `&excludeEntry=${editId}` : ""}`
    )
      .then((d) => { setOrders(d.orders); setTotalOutstanding(d.totalOutstandingPaise); setExistingOnAccount(d.onAccountPaise); })
      .catch((e) => setError(e.message));
  }, [institute, editId]);

  const amountPaise = toPaise(amount);
  const allocated = useMemo(() => Object.values(alloc).reduce((s, v) => s + toPaise(v), 0), [alloc]);
  const onAccount = amountPaise - allocated;
  const dedPaise = toPaise(deduction);
  const overOrder = orders.find((o) => toPaise(alloc[o.id] || "") > o.outstandingPaise);
  const invalid = amountPaise <= 0 || onAccount < 0 || !!overOrder || (dedPaise > 0 && allocated === 0);

  const doAuto = () => {
    const { split } = autoSplit(amountPaise, orders);
    setAlloc(Object.fromEntries(Object.entries(split).map(([id, p]) => [id, String(p / 100)])));
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      setBusy(true);
      setError("");
      const allocations = Object.entries(alloc).filter(([, v]) => toPaise(v) > 0).map(([orderId, a]) => ({ orderId, amount: a }));
      const payload = { institute, amount, date, remark, accountId, allocations, deduction, deductionType };
      if (editId) await cbFetch(`/api/cashbook/order-payments/${editId}`, { method: "PUT", json: payload });
      else await cbFetch("/api/cashbook/order-payments", { method: "POST", json: payload });
      router.push("/dashboard/account/cashbook");
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  const input = "w-full border border-slate-300 rounded-lg px-3 py-3 text-base bg-white";
  const label = "block text-[11px] font-bold uppercase text-slate-500 mb-1";
  const auto = can("cashbookApprove");

  return (
    <div className="p-4 bg-slate-50 min-h-screen">
      <div className="max-w-xl mx-auto flex flex-col gap-4">
        <Link href="/dashboard/account/cashbook" className="flex items-center gap-2 text-slate-500 text-xs w-fit"><FiArrowLeft /> Cashbook</Link>
        <h1 className="text-xl font-black uppercase text-slate-900">Cash payment received</h1>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-4">
          {!institute ? (
            <div>
              <label className={label}>Institute</label>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Institute ka naam search karo" className={input} />
              <div className="mt-2 max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {list.length === 0 && <p className="p-3 text-sm text-slate-400">Koi institute nahi mila (sirf jinka paisa baaki hai)</p>}
                {list.map((i) => (
                  <button type="button" key={i.name} onClick={() => setInstitute(i.name)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50">
                    <p className="text-sm font-semibold text-slate-800">{i.name}</p>
                    <p className="text-[11px] text-slate-400">{i.pendingOrders} pending orders · baaki {fmtPaise(Math.round(i.outstanding * 100))}{i.onAccount ? ` · on account ${fmtPaise(Math.round(i.onAccount * 100))}` : ""}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <div className="flex justify-between gap-2">
                  <p className="font-bold text-slate-900">{institute}</p>
                  {!editId && <button type="button" onClick={() => { setInstitute(""); setOrders([]); setAlloc({}); }} className="text-xs text-blue-600 font-bold">Badlo</button>}
                </div>
                <p className="text-sm text-slate-600 mt-1">Total baaki: <b>{fmtPaise(totalOutstanding)}</b>{existingOnAccount > 0 && <> · On account pehle se: <b>{fmtPaise(existingOnAccount)}</b></>}</p>
              </div>

              <div>
                <label className={label}>Cash mila (₹)</label>
                <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${input} text-2xl font-black`} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`${label} mb-0`}>Pending orders (purane pehle)</label>
                  <button type="button" onClick={doAuto} disabled={amountPaise <= 0} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-40">Auto baanto</button>
                </div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {orders.length === 0 && <p className="p-3 text-sm text-slate-400">Koi pending order nahi, poora paisa On account jayega.</p>}
                  {orders.map((o) => {
                    const v = alloc[o.id] || "";
                    const bad = toPaise(v) > o.outstandingPaise;
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{o.orderNo}</p>
                          <p className="text-[11px] text-slate-400">{o.contractDate} · baaki {fmtPaise(o.outstandingPaise)}</p>
                        </div>
                        <input inputMode="decimal" value={v} onChange={(e) => setAlloc((a) => ({ ...a, [o.id]: e.target.value }))} placeholder="₹" className={`w-28 border rounded-lg px-2 py-1.5 text-right ${bad ? "border-red-500 bg-red-50" : "border-slate-300"}`} />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={`rounded-xl p-3 text-sm ${onAccount < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
                <div className="flex justify-between"><span>Orders mein</span><b>{fmtPaise(allocated)}</b></div>
                <div className="flex justify-between"><span>On account (order se baad mein jodna)</span><b>{fmtPaise(onAccount)}</b></div>
                {onAccount < 0 && <p className="text-xs mt-1">Orders ko baante gaye paise mile hue amount se zyada hain.</p>}
                {overOrder && <p className="text-xs mt-1">Order {overOrder.orderNo} ke baaki se zyada likha hai.</p>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Deduction (optional)</label>
                  <input inputMode="decimal" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="₹" className={input} />
                </div>
                <div>
                  <label className={label}>Type</label>
                  <select value={deductionType} onChange={(e) => setDeductionType(e.target.value)} className={input}>
                    <option value="TDS">TDS</option><option value="TDS+GST">TDS+GST</option><option value="Kasar">Kasar</option>
                  </select>
                </div>
              </div>
              {dedPaise > 0 && allocated === 0 && <p className="text-xs text-red-600 -mt-2">Deduction ke liye pehle kisi order mein paisa baanto.</p>}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Date</label>
                  <input type="date" required value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className={input} />
                </div>
                {accounts.length > 1 && (
                  <div>
                    <label className={label}>Cash account</label>
                    <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className={label}>Remark (optional)</label>
                <input value={remark} onChange={(e) => setRemark(e.target.value)} className={input} />
              </div>
              {editId && <p className="text-xs text-amber-700">Approved payment badalne par purana poora hat kar naya lagega. Baad mein "Order se jodo" se jude paise bhi hat jayenge.</p>}
            </>
          )}

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          {institute && (
            <button disabled={busy || invalid} className="py-3.5 rounded-xl bg-slate-900 text-white font-black uppercase disabled:opacity-40">
              {busy ? "Please wait..." : auto ? "Save" : "Submit for approval"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default function OrderPaymentPage() {
  return (
    <BlockGuard permission="cashbookOrderPayment" fallback={noAccess}>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </BlockGuard>
  );
}
