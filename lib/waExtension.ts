// Client-side helpers for talking to the "DEV WA Bulk Sender" Chrome extension
// (browser-extension/DEV-WA-Bulk-Sender). The extension injects
// oms-connector.js into OMS pages; we talk to it via window.postMessage, so no
// extension ID is needed and nothing has to run on a server - the actual
// WhatsApp sending happens inside the user's own logged-in WhatsApp Web tab.
//
// Every queued item carries a `ref` so its Sent/Failed result can be written
// back to the right DB record later (see components/WaExtensionSync.tsx):
//   courier|<runDate>|<docketNo>   -> CourierRunLog.matched[].whatsappStatus
//   dc|<deliveryChallanWhatsappId> -> delivery_challan_whatsapp.status

export interface WaFile {
  name: string;
  type: string;
  dataUrl: string;
}

export interface WaItem {
  phone: string;
  name?: string;
  msg?: string;
  files?: WaFile[];
  ref: string;
}

export interface WaResult {
  ref: string;
  status: "Sent" | "Failed";
  reason: string;
  time: number;
}

export interface WaEnqueueResponse {
  ok: boolean;
  error?: string;
  queued?: number;
  duplicates?: number;
  rejected?: number;
  started?: boolean;
  warning?: string;
}

let seq = 0;

function callExtension<T = any>(action: string, payload?: any, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in a browser"));
    const id = `oms-${Date.now()}-${++seq}`;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.src !== "devwa-oms-res" || d.id !== id) return;
      cleanup();
      resolve(d.result as T);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("DEV WA Bulk Sender extension se jawab nahi aaya"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ src: "devwa-oms-req", id, action, payload }, window.location.origin);
  });
}

/** Resolves to the extension version if it's installed + active on this page, else null. */
export async function pingWaExtension(): Promise<string | null> {
  try {
    const r = await callExtension<{ ok: boolean; version?: string }>("ping", undefined, 1500);
    return r && r.ok ? r.version || "?" : null;
  } catch {
    return null;
  }
}

export const WA_EXTENSION_MISSING_MSG =
  "DEV WA Bulk Sender extension (v2.1+) nahi mila. Chrome me chrome://extensions se " +
  "browser-extension/DEV-WA-Bulk-Sender folder 'Load unpacked' karo (ya Reload dabao), phir yeh page refresh karo.";

export async function enqueueWa(items: WaItem[]): Promise<WaEnqueueResponse> {
  // Large PDFs pass through chrome.storage - give it a bit longer than a ping
  return callExtension<WaEnqueueResponse>("enqueue", { items }, 30000);
}

export async function getWaResults(): Promise<WaResult[]> {
  const r = await callExtension<{ ok: boolean; results?: Record<string, WaResult> }>("results");
  return r && r.ok && r.results ? Object.values(r.results) : [];
}

export async function ackWaResults(refs: string[]): Promise<void> {
  if (refs.length) await callExtension("ack", { refs });
}

/** Fired on window after results were written to the DB, so pages can refetch. */
export const WA_RESULTS_SYNCED_EVENT = "devwa-results-synced";

export function buildCourierMessage(p: { instituteName: string; buyerName?: string; docketNo: string }): string {
  return (
    `Namaste ${p.buyerName || p.instituteName},\n\n` +
    `Your Parcel Dispatch From Our Side,\n` +
    `Tracking\n` +
    `Docket No: ${p.docketNo}\n\n` +
    `Track at shreemahavircourier.com with this docket number.\n\n` +
    `*DEV ENTERPRISE GROUPS (FIRMS)*`
  );
}
