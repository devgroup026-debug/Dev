"use client";
import { useEffect } from "react";
import { ackWaResults, getWaResults, pingWaExtension, WA_RESULTS_SYNCED_EVENT } from "@/lib/waExtension";

// Mounted once in the root layout. Pulls Sent/Failed results the
// DEV WA Bulk Sender extension has recorded for OMS-queued messages, writes
// them to the DB, then acks them so the extension forgets them. Runs on any
// OMS page (not just Courier Tracking), so results still land even if the
// user navigated away while the WhatsApp tab was sending.
export default function WaExtensionSync() {
  useEffect(() => {
    let running = false;
    let stopped = false;

    const sync = async () => {
      if (running || stopped) return;
      running = true;
      try {
        if (!(await pingWaExtension())) return;
        const results = await getWaResults();
        if (!results.length) return;

        const courier: { ref: string; date: string; docketNo: string; status: string }[] = [];
        const dc: { ref: string; id: string; status: string; errorMessage: string }[] = [];
        const unknown: string[] = [];

        for (const r of results) {
          const status = r.status === "Sent" ? "SENT" : "FAILED";
          const parts = r.ref.split("|");
          if (parts[0] === "courier" && parts.length >= 3) {
            courier.push({ ref: r.ref, date: parts[1], docketNo: parts.slice(2).join("|"), status });
          } else if (parts[0] === "dc" && parts[1]) {
            dc.push({ ref: r.ref, id: parts[1], status, errorMessage: r.reason || "" });
          } else {
            unknown.push(r.ref);
          }
        }

        const acked: string[] = [...unknown];

        if (courier.length) {
          const res = await fetch("/api/courier/whatsapp-result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: courier.map(({ date, docketNo, status }) => ({ date, docketNo, status })) }),
          });
          if (res.ok) acked.push(...courier.map((c) => c.ref));
        }

        if (dc.length) {
          const res = await fetch("/api/delivery-challan/whatsapp-result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: dc.map(({ id, status, errorMessage }) => ({ id, status, errorMessage })) }),
          });
          if (res.ok) acked.push(...dc.map((d) => d.ref));
        }

        if (acked.length) {
          await ackWaResults(acked);
          window.dispatchEvent(new Event(WA_RESULTS_SYNCED_EVENT));
        }
      } catch (e) {
        console.error("WhatsApp extension result sync failed", e);
      } finally {
        running = false;
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      if (e.data?.src === "devwa-oms-event" && e.data.type === "results-changed") sync();
    };

    window.addEventListener("message", onMessage);
    sync();
    const interval = setInterval(sync, 30000);
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
