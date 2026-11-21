"use client";
import { useEffect, useRef, useState } from "react";
import { FiTruck, FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiPackage, FiSend, FiEdit2, FiUpload } from "react-icons/fi";
import {
  buildCourierMessage,
  enqueueWa,
  pingWaExtension,
  WA_EXTENSION_MISSING_MSG,
  WA_RESULTS_SYNCED_EVENT,
  type WaEnqueueResponse,
} from "@/lib/waExtension";

/** Human summary of what the extension did with a batch. */
function describeEnqueue(r: WaEnqueueResponse, noun: string): string {
  let msg = `${r.queued ?? 0} ${noun} DEV WA Bulk Sender me queue ho gaye - WhatsApp Web tab ek-ek karke bhejega.`;
  if (r.duplicates) msg += ` ${r.duplicates} pehle se queue me the (skip).`;
  if (r.rejected) msg += ` ${r.rejected} ka number invalid tha.`;
  if (r.warning) msg += ` Note: ${r.warning}`;
  return msg;
}

interface SellerOption {
  _id: string;
  instituteName: string;
  place?: string;
}

/**
 * Type-to-search institute picker (replaces a plain <select> with hundreds of
 * sellers). The list is position:fixed so the table's overflow-x-auto
 * wrapper can't clip it. Enter picks the highlighted row, Esc / click
 * outside cancels.
 */
function InstituteSearchSelect({
  options,
  disabled,
  placeholder = "Institute / city search karo...",
  onSelect,
  onCancel,
}: {
  options: SellerOption[];
  disabled?: boolean;
  placeholder?: string;
  onSelect: (id: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = (() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options.slice(0, 100);
    return options
      .filter((o) => {
        const hay = `${o.instituteName} ${o.place || ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 100);
  })();

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const openUp = below < 200 && above > below;
    const maxHeight = Math.min(280, openUp ? above : below);
    setPos({ left: r.left, width: Math.max(r.width, 300), maxHeight, top: openUp ? r.top - maxHeight - 4 : r.bottom + 4 });
  };

  useEffect(() => {
    inputRef.current?.focus();
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) onCancel();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) onSelect(filtered[active]._id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div ref={wrapRef} className="relative inline-block w-[240px]">
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full text-xs font-semibold border border-blue-400 rounded-lg px-2 py-1 bg-white outline-none focus:ring-2 focus:ring-blue-200"
      />
      {pos && (
        <ul
          ref={listRef}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-50 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1 text-xs"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-400 font-semibold">Koi institute nahi mila</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o._id}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(o._id);
                }}
                className={`px-3 py-1.5 cursor-pointer ${i === active ? "bg-blue-50 text-blue-800" : "text-slate-700"}`}
              >
                <span className="font-bold">{o.instituteName}</span>
                {o.place && <span className="text-slate-400"> ({o.place})</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

interface MatchedParcel {
  docketNo: string;
  instituteName: string;
  buyerName?: string;
  city: string;
  receiverName: string;
  score: number;
  whatsappNumber?: string;
  whatsappStatus?: "NOT_SENT" | "PENDING" | "SENT" | "FAILED" | "NO_NUMBER";
  emailDate?: string;
}

interface ReviewParcel {
  docketNo: string;
  parsedCity: string;
  parsedReceiverName: string;
  bestGuessInstituteName?: string;
  score: number;
  reason: string;
  emailDate?: string;
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY" for display. */
function formatEmailDate(d?: string): string {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}/${m}/${y}` : d;
}

interface DcWhatsappRecord {
  _id: string;
  instituteName: string;
  whatsappNumber: string;
  orderNos: string[];
  fileName: string;
  status: "PENDING" | "SENT" | "FAILED";
  requestedBy?: string;
  requestedAt: string;
  sentAt?: string | null;
  errorMessage?: string | null;
}

interface CourierRunLog {
  _id: string;
  date: string;
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  totalParcels?: number;
  matchedCount?: number;
  needsReviewCount?: number;
  matched?: MatchedParcel[];
  needsReview?: ReviewParcel[];
  timestamp: string;
  error?: string;
  triggeredBy?: string;
}

export default function CourierTrackingPage() {
  const [runLoading, setRunLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });
  const [selectedDockets, setSelectedDockets] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [dcWhatsappRecords, setDcWhatsappRecords] = useState<DcWhatsappRecord[]>([]);
  // undefined = still checking, null = extension not found, string = version
  const [extVersion, setExtVersion] = useState<string | null | undefined>(undefined);
  const [resendingDcId, setResendingDcId] = useState<string | null>(null);
  const [editingDocket, setEditingDocket] = useState<string | null>(null);
  const [savingInstitute, setSavingInstitute] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // Which "Needs Review" row is having its institute picked by hand
  const [assigningDocket, setAssigningDocket] = useState<string | null>(null);

  const [autoStatus, setAutoStatus] = useState<{
    todayRunCompleted: boolean;
    todayLog: CourierRunLog | null;
    history: CourierRunLog[];
    gmailConfigured: boolean;
    gmailDisabled: boolean;
    courierSenderConfigured: boolean;
  }>({
    todayRunCompleted: false,
    todayLog: null,
    history: [],
    gmailConfigured: false,
    gmailDisabled: false,
    courierSenderConfigured: false,
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/courier/auto");
      const data = await res.json();
      if (res.ok) {
        setAutoStatus({
          todayRunCompleted: data.todayRunCompleted,
          todayLog: data.todayLog,
          history: data.history || [],
          gmailConfigured: data.gmailConfigured,
          gmailDisabled: !!data.gmailDisabled,
          courierSenderConfigured: data.courierSenderConfigured,
        });
      }
    } catch (e) {
      console.error("Failed to fetch courier run status", e);
    }
  };

  // Manual alternative to the Gmail fetch: upload the courier's
  // booking-register PDF(s); parcels are parsed, matched and merged into
  // today's list below.
  const handleUploadPdfs = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    setUploading(true);
    setStatus({ type: null, message: "" });
    try {
      const form = new FormData();
      Array.from(fileList).forEach((f) => form.append("files", f));
      const res = await fetch("/api/courier/upload-pdf", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      const fileProblems = (data.files || [])
        .filter((f: any) => f.error)
        .map((f: any) => `${f.name}: ${f.error}`)
        .join(" | ");
      if (!res.ok) throw new Error((data.error || "PDF upload failed") + (fileProblems ? ` (${fileProblems})` : ""));
      setStatus({ type: "success", message: data.message + (fileProblems ? ` | ${fileProblems}` : "") });
      setSelectedDockets(new Set());
      await fetchStatus();
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const fetchDcWhatsappStatus = async () => {
    try {
      const res = await fetch("/api/delivery-challan/whatsapp-status");
      const data = await res.json();
      if (res.ok) setDcWhatsappRecords(data.records || []);
    } catch (e) {
      console.error("Failed to fetch Delivery Challan WhatsApp status", e);
    }
  };

  // WhatsApp sending goes through the DEV WA Bulk Sender Chrome extension
  // (the user's own WhatsApp Web tab) - re-check every 15s so the badge
  // updates if the extension gets enabled/reloaded while this page is open.
  useEffect(() => {
    const check = async () => setExtVersion(await pingWaExtension());
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

  // WaExtensionSync (root layout) fires this after writing Sent/Failed
  // results to the DB - refetch so status pills update live.
  useEffect(() => {
    const onSynced = () => {
      fetchStatus();
      fetchDcWhatsappStatus();
    };
    window.addEventListener(WA_RESULTS_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(WA_RESULTS_SYNCED_EVENT, onSynced);
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchDcWhatsappStatus();
    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => {
        const list = (Array.isArray(data) ? data : [])
          .map((s: any) => ({ _id: s._id, instituteName: s.instituteName, place: s.place }))
          .filter((s: any) => s.instituteName)
          .sort((a: any, b: any) => a.instituteName.localeCompare(b.instituteName));
        setSellers(list);
      })
      .catch((e) => console.error("Failed to fetch sellers for institute correction", e));
  }, []);

  const handleRunNow = async () => {
    if (runLoading) return;
    setRunLoading(true);
    setStatus({ type: null, message: "" });
    try {
      const res = await fetch("/api/courier/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: "success", message: data.message || "Courier run completed." });
        setSelectedDockets(new Set());
        await fetchStatus();
      } else {
        throw new Error(data.error || "Failed to trigger courier run");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setRunLoading(false);
    }
  };

  const todayLog = autoStatus.todayLog;

  // NOT_SENT/FAILED/PENDING parcels can be selected. PENDING stays
  // selectable so anything stuck "Queued" (e.g. from the old bridge, or an
  // extension queue that got cleared) can be pushed again - the extension
  // itself skips a parcel that's still waiting in its queue, so this can't
  // double-send. SENT is done, NO_NUMBER has nothing to send to.
  const isSelectable = (s?: MatchedParcel["whatsappStatus"]) =>
    s === "NOT_SENT" || s === "FAILED" || s === "PENDING";
  const selectableDockets = (todayLog?.matched || [])
    .filter((m) => isSelectable(m.whatsappStatus))
    .map((m) => m.docketNo);

  const toggleDocket = (docketNo: string) => {
    setSelectedDockets((prev) => {
      const next = new Set(prev);
      if (next.has(docketNo)) next.delete(docketNo);
      else next.add(docketNo);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedDockets((prev) =>
      prev.size === selectableDockets.length ? new Set() : new Set(selectableDockets)
    );
  };

  const handleSendWhatsApp = async () => {
    if (sending || selectedDockets.size === 0 || !todayLog) return;
    setSending(true);
    setStatus({ type: null, message: "" });
    try {
      const version = await pingWaExtension();
      setExtVersion(version);
      if (!version) throw new Error(WA_EXTENSION_MISSING_MSG);

      const parcels = (todayLog.matched || []).filter(
        (m) => selectedDockets.has(m.docketNo) && m.whatsappNumber
      );
      if (parcels.length === 0) throw new Error("Selected parcels me koi WhatsApp number nahi hai.");

      // 1) Hand the messages to the extension first - if that fails nothing
      //    gets marked Queued in the DB.
      const r = await enqueueWa(
        parcels.map((m) => ({
          phone: m.whatsappNumber!,
          name: m.instituteName,
          msg: buildCourierMessage(m),
          ref: `courier|${todayLog.date}|${m.docketNo}`,
        }))
      );
      if (!r.ok) throw new Error(r.error || "Extension ne queue nahi kiya");

      // 2) Mark them Queued (PENDING) in the DB; Sent/Failed arrives later
      //    via WaExtensionSync.
      const res = await fetch("/api/courier/queue-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayLog.date, docketNos: parcels.map((m) => m.docketNo) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("queue-whatsapp status update failed", data);
      }

      setStatus({ type: "success", message: describeEnqueue(r, "message(s)") });
      setSelectedDockets(new Set());
      await fetchStatus();
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSending(false);
    }
  };

  const handleInstituteChange = async (docketNo: string, sellerId: string) => {
    if (!sellerId || !todayLog) {
      setEditingDocket(null);
      setAssigningDocket(null);
      return;
    }
    setSavingInstitute(true);
    setStatus({ type: null, message: "" });
    try {
      const res = await fetch("/api/courier/update-matched-institute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayLog.date, docketNo, sellerId }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: "success", message: "Institute corrected." });
        setEditingDocket(null);
        setAssigningDocket(null);
        await fetchStatus();
      } else {
        throw new Error(data.error || "Failed to update institute");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSavingInstitute(false);
    }
  };

  // Re-send one Delivery Challan row (stuck Queued from the old bridge, or
  // Failed) through the extension, using the PDF stored with the record.
  const handleResendDc = async (id: string) => {
    if (resendingDcId) return;
    setResendingDcId(id);
    setStatus({ type: null, message: "" });
    try {
      const version = await pingWaExtension();
      setExtVersion(version);
      if (!version) throw new Error(WA_EXTENSION_MISSING_MSG);

      const res = await fetch(`/api/delivery-challan/whatsapp-pdf?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "PDF load nahi hua");
      const rec = data.record;
      if (!rec.pdfBase64) {
        throw new Error("Is record ki PDF saved nahi hai - Orders page se 'Send DC WhatsApp' dobara dabao.");
      }

      const r = await enqueueWa([
        {
          phone: rec.whatsappNumber,
          name: rec.instituteName,
          msg: `Delivery Challan - ${rec.instituteName}\nOrder(s): ${(rec.orderNos || []).join(", ")}`,
          files: [{ name: rec.fileName, type: "application/pdf", dataUrl: `data:application/pdf;base64,${rec.pdfBase64}` }],
          ref: `dc|${rec._id}`,
        },
      ]);
      if (!r.ok) throw new Error(r.error || "Extension ne queue nahi kiya");
      setStatus({ type: "success", message: describeEnqueue(r, "Delivery Challan") });
    } catch (err: any) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setResendingDcId(null);
    }
  };

  return (
      <div className="min-h-screen bg-slate-50 p-6 flex justify-center">
        <div className="max-w-5xl w-full flex flex-col gap-6">
          {/* Header Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-orange-50 p-4 rounded-xl text-orange-600">
                <FiTruck size={28} />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Courier Tracking Automation
                </h1>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  Dispatch register → institute matching
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  autoStatus.gmailDisabled
                    ? "bg-slate-100 text-slate-600 border border-slate-300"
                    : autoStatus.gmailConfigured
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}
              >
                {autoStatus.gmailDisabled
                  ? "Gmail Off - PDF Upload"
                  : autoStatus.gmailConfigured
                  ? "Gmail Connected"
                  : "Gmail Setup Pending"}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  autoStatus.courierSenderConfigured
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}
              >
                {autoStatus.courierSenderConfigured ? "Courier Sender Set" : "Courier Sender Pending"}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  extVersion
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : extVersion === null
                    ? "bg-red-100 text-red-800 border border-red-300"
                    : "bg-slate-100 text-slate-600 border border-slate-300"
                }`}
              >
                {extVersion
                  ? `WA Extension v${extVersion} Ready`
                  : extVersion === null
                  ? "WA Extension Not Found"
                  : "Checking WA Extension..."}
              </span>
            </div>
          </div>

          {extVersion === null && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-start gap-4">
              <FiAlertTriangle size={24} className="text-red-600 shrink-0" />
              <div>
                <h3 className="text-sm font-black text-red-800 uppercase mb-1">DEV WA Bulk Sender extension nahi mila</h3>
                <p className="text-xs text-red-700 font-bold leading-relaxed">
                  WhatsApp message ab is Chrome extension se jaate hain. Chrome me <code>chrome://extensions</code> kholo →
                  Developer mode ON → <b>Load unpacked</b> → <code>browser-extension\DEV-WA-Bulk-Sender</code> folder
                  select karo (pehle se laga hai to <b>Reload</b> dabao). Phir yeh page refresh karo aur ek tab me
                  web.whatsapp.com login rakho.
                </p>
              </div>
            </div>
          )}

          {status.type === "success" && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-800 text-xs font-bold leading-normal">
              <FiCheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <span>{status.message}</span>
            </div>
          )}
          {status.type === "error" && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-800 text-xs font-bold leading-normal">
              <FiAlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <span>{status.message}</span>
            </div>
          )}

          {/* Today's run summary + Run Now */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-black uppercase text-orange-600 bg-orange-50 px-2.5 py-1 rounded-lg">
                  First-Login Auto-Run
                </span>
                <span className="text-xs text-slate-400 font-medium">Daily, once per calendar day</span>
              </div>

              <p className="text-slate-600 text-xs leading-relaxed mb-4">
                Triggers automatically the first time OMS is opened each day - fetches every courier PDF mail
                received since the last successful fetch (so a courier mail that arrives late or after a missed
                day still gets picked up), parses each parcel, and matches it to an institute by receiver name +
                city. Each entry shows the date of its own courier email. WhatsApp sending is always manual -
                select the parcels you want to notify below and press &quot;Send WhatsApp&quot;; the selected
                messages are handed to the DEV WA Bulk Sender extension, which sends them one by one from your
                logged-in WhatsApp Web tab. Nothing gets messaged on its own.
              </p>

              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 mb-6 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">Today Status:</span>
                  <span className={`font-black ${autoStatus.todayRunCompleted ? "text-emerald-600" : "text-amber-600"}`}>
                    {autoStatus.todayRunCompleted ? "COMPLETED TODAY" : "PENDING / NOT RUN YET"}
                  </span>
                </div>
                {todayLog && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Run Time:</span>
                      <span className="text-slate-700 font-mono">{new Date(todayLog.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Total Parcels:</span>
                      <span className="text-slate-700 font-mono">{todayLog.totalParcels ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Matched:</span>
                      <span className="text-emerald-700 font-mono">{todayLog.matchedCount ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-semibold">Needs Review:</span>
                      <span className="text-amber-700 font-mono">{todayLog.needsReviewCount ?? 0}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <input
              ref={uploadInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => handleUploadPdfs(e.target.files)}
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={uploading}
                onClick={() => uploadInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-black uppercase text-xs tracking-wider py-3.5 rounded-xl transition-all hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40"
                title="Courier ki booking register PDF (MOHIT ENTERPRISE / Shree Mahavir) upload karo"
              >
                {uploading ? (
                  <>
                    <FiRefreshCw size={14} className="animate-spin" />
                    <span>Reading PDF...</span>
                  </>
                ) : (
                  <>
                    <FiUpload size={16} />
                    <span>Upload Courier PDF</span>
                  </>
                )}
              </button>
              {!autoStatus.gmailDisabled && (
                <button
                  type="button"
                  disabled={runLoading}
                  onClick={handleRunNow}
                  className="flex-1 flex items-center justify-center gap-2 bg-orange-600 text-white font-black uppercase text-xs tracking-wider py-3.5 rounded-xl transition-all hover:bg-orange-700 active:scale-[0.98] disabled:opacity-40"
                >
                  {runLoading ? (
                    <>
                      <FiRefreshCw size={14} className="animate-spin" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <FiPackage size={16} />
                      <span>Run Now (Gmail)</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Matched */}
          {todayLog?.matched && todayLog.matched.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h3 className="text-sm font-black text-slate-900 uppercase">Matched ({todayLog.matched.length})</h3>
                <button
                  type="button"
                  disabled={selectedDockets.size === 0 || sending}
                  onClick={handleSendWhatsApp}
                  className="flex items-center gap-2 bg-emerald-600 text-white font-black uppercase text-[11px] tracking-wider px-4 py-2.5 rounded-xl transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <FiRefreshCw size={13} className="animate-spin" />
                  ) : (
                    <FiSend size={13} />
                  )}
                  {sending ? "Queueing..." : `Send WhatsApp (${selectedDockets.size} Selected)`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[10px] tracking-wide">
                      <th className="pb-2 pr-3 w-8">
                        <input
                          type="checkbox"
                          checked={selectableDockets.length > 0 && selectedDockets.size === selectableDockets.length}
                          onChange={toggleSelectAll}
                          disabled={selectableDockets.length === 0}
                          className="w-3.5 h-3.5"
                        />
                      </th>
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Docket No</th>
                      <th className="pb-2 pr-4">Institute</th>
                      <th className="pb-2 pr-4">City</th>
                      <th className="pb-2 pr-4">Receiver</th>
                      <th className="pb-2 pr-4">Score</th>
                      <th className="pb-2">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {todayLog.matched.map((m) => {
                      const selectable = isSelectable(m.whatsappStatus);
                      return (
                        <tr key={m.docketNo}>
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={selectedDockets.has(m.docketNo)}
                              onChange={() => toggleDocket(m.docketNo)}
                              disabled={!selectable}
                              className="w-3.5 h-3.5"
                            />
                          </td>
                          <td className="py-2 pr-4 text-slate-500 font-mono whitespace-nowrap">{formatEmailDate(m.emailDate)}</td>
                          <td className="py-2 pr-4 font-mono">{m.docketNo}</td>
                          <td className="py-2 pr-4 font-bold text-slate-800">
                            {editingDocket === m.docketNo ? (
                              <InstituteSearchSelect
                                options={sellers}
                                disabled={savingInstitute}
                                onSelect={(id) => handleInstituteChange(m.docketNo, id)}
                                onCancel={() => setEditingDocket(null)}
                              />
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                {m.instituteName}
                                <button
                                  type="button"
                                  onClick={() => setEditingDocket(m.docketNo)}
                                  className="text-slate-300 hover:text-slate-600 transition-colors"
                                  title="Fix wrong institute match"
                                >
                                  <FiEdit2 size={11} />
                                </button>
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-slate-500">{m.city}</td>
                          <td className="py-2 pr-4 text-slate-500">{m.receiverName}</td>
                          <td className="py-2 pr-4 text-emerald-700 font-mono">{m.score.toFixed(2)}</td>
                          <td className="py-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                m.whatsappStatus === "SENT"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : m.whatsappStatus === "FAILED"
                                  ? "bg-red-100 text-red-700"
                                  : m.whatsappStatus === "NO_NUMBER"
                                  ? "bg-slate-100 text-slate-500"
                                  : m.whatsappStatus === "PENDING"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {m.whatsappStatus === "NO_NUMBER"
                                ? "No Number"
                                : m.whatsappStatus === "NOT_SENT"
                                ? "Not Sent"
                                : m.whatsappStatus === "PENDING"
                                ? "Queued"
                                : m.whatsappStatus || "Not Sent"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Needs Review */}
          {todayLog?.needsReview && todayLog.needsReview.length > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-sm">
              <h3 className="text-sm font-black text-amber-700 uppercase mb-4">
                Needs Review ({todayLog.needsReview.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[10px] tracking-wide">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Docket No</th>
                      <th className="pb-2 pr-4">Parsed City</th>
                      <th className="pb-2 pr-4">Parsed Receiver</th>
                      <th className="pb-2 pr-4">Best Guess</th>
                      <th className="pb-2 pr-4">Score</th>
                      <th className="pb-2 pr-4">Reason</th>
                      <th className="pb-2">Assign</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {todayLog.needsReview.map((r) => (
                      <tr key={r.docketNo}>
                        <td className="py-2 pr-4 text-slate-500 font-mono whitespace-nowrap">{formatEmailDate(r.emailDate)}</td>
                        <td className="py-2 pr-4 font-mono">{r.docketNo}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.parsedCity}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.parsedReceiverName}</td>
                        <td className="py-2 pr-4 text-slate-700">{r.bestGuessInstituteName || "-"}</td>
                        <td className="py-2 pr-4 text-amber-700 font-mono">{r.score.toFixed(2)}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.reason}</td>
                        <td className="py-2">
                          {assigningDocket === r.docketNo ? (
                            <InstituteSearchSelect
                              options={sellers}
                              disabled={savingInstitute}
                              onSelect={(id) => handleInstituteChange(r.docketNo, id)}
                              onCancel={() => setAssigningDocket(null)}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAssigningDocket(r.docketNo)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-amber-100 text-amber-800 hover:bg-amber-200"
                              title="Sahi institute chuno - parcel Matched list me chala jayega"
                            >
                              <FiEdit2 size={10} /> Assign
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {todayLog && !todayLog.matched?.length && !todayLog.needsReview?.length && (
            <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
              {todayLog.error || "No parcels processed yet today."}
            </p>
          )}

          {/* Delivery Challan WhatsApp Status - separate from the courier
              dispatch-notification tracking above; this is the Orders page's
              "Send DC WhatsApp" button's send status. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-700 uppercase flex items-center gap-2">
                <FiSend className="text-emerald-600" /> Delivery Challan WhatsApp Status
              </h3>
              <button
                onClick={fetchDcWhatsappStatus}
                className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                title="Refresh"
              >
                <FiRefreshCw size={14} />
              </button>
            </div>
            {dcWhatsappRecords.length === 0 ? (
              <p className="text-xs font-bold text-slate-400 p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                No Delivery Challan WhatsApp sends yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[10px] tracking-wide">
                      <th className="pb-2 pr-4">Requested</th>
                      <th className="pb-2 pr-4">Institute</th>
                      <th className="pb-2 pr-4">Order No(s)</th>
                      <th className="pb-2 pr-4">WhatsApp No.</th>
                      <th className="pb-2 pr-4">Requested By</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dcWhatsappRecords.map((r) => (
                      <tr key={r._id}>
                        <td className="py-2 pr-4 text-slate-500 font-mono whitespace-nowrap">
                          {new Date(r.requestedAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-2 pr-4 text-slate-700 font-bold">{r.instituteName}</td>
                        <td className="py-2 pr-4 text-slate-500">{(r.orderNos || []).join(", ")}</td>
                        <td className="py-2 pr-4 text-slate-500 font-mono">{r.whatsappNumber}</td>
                        <td className="py-2 pr-4 text-slate-500">{r.requestedBy || "-"}</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              r.status === "SENT"
                                ? "bg-emerald-50 text-emerald-700"
                                : r.status === "FAILED"
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                            title={r.status === "FAILED" ? r.errorMessage || "" : ""}
                          >
                            {r.status === "PENDING" ? "Queued" : r.status === "SENT" ? "Sent" : "Failed"}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {r.status !== "SENT" && (
                            <button
                              type="button"
                              disabled={!!resendingDcId}
                              onClick={() => handleResendDc(r._id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                              title="DEV WA Bulk Sender extension se bhejo"
                            >
                              {resendingDcId === r._id ? <FiRefreshCw size={10} className="animate-spin" /> : <FiSend size={10} />}
                              Send
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
