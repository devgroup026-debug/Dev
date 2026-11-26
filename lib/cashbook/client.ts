"use client";
// Client helpers for the Cashbook pages.
import { useEffect, useState } from "react";

export const CB_PERMISSIONS: { key: string; label: string }[] = [
  { key: "cashbookView", label: "Cashbook page dekhna (base access)" },
  { key: "cashbookEntry", label: "Cash In/Out entry banana (apni pending entry edit/delete)" },
  { key: "cashbookApprove", label: "Entries Approve / Reject karna" },
  { key: "cashbookAllEntries", label: "Sabki entries aur balance cards dekhna" },
  { key: "cashbookEditApproved", label: "Approved entries edit / delete karna" },
  { key: "cashbookAdvance", label: "Staff advance: top-up / paise wapas lo / sab ka ledger" },
  { key: "cashbookOrderPayment", label: "Institute se cash payment receive / on-account allocate" },
  { key: "cashbookMasters", label: "Accounts aur Categories master" },
  { key: "cashbookReports", label: "Cashbook reports aur Excel export" },
];

export interface OmsUser {
  username: string;
  permissions: Record<string, boolean>;
}

/** Logged-in user from localStorage, refreshed with the latest permissions from the server. */
export function useOmsUser() {
  const [user, setUser] = useState<OmsUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let parsed: any = null;
    try {
      parsed = JSON.parse(localStorage.getItem("oms_user") || "null");
    } catch {}
    if (parsed) setUser(parsed);
    setReady(true);
    if (parsed?.username) {
      fetch(`/api/users?username=${encodeURIComponent(parsed.username)}`)
        .then((r) => r.json())
        .then((u) => {
          if (u?.permissions) {
            const fresh = { ...parsed, permissions: u.permissions };
            try {
              localStorage.setItem("oms_user", JSON.stringify(fresh));
            } catch {}
            setUser(fresh);
          }
        })
        .catch(() => {});
    }
  }, []);
  const isAdmin =
    !!user && (["admin", "chintan", "hitesh"].includes(user.username.trim().toLowerCase()) || user.permissions?.boss === true);
  const can = (p: string) => isAdmin || user?.permissions?.[p] === true;
  return { user, ready, isAdmin, can };
}

/** fetch() that identifies the user to the cashbook API and parses JSON / errors. */
export async function cbFetch<T = any>(url: string, init: RequestInit & { json?: any } = {}): Promise<T> {
  let username = "";
  try {
    username = JSON.parse(localStorage.getItem("oms_user") || "null")?.username || "";
  } catch {}
  const headers: Record<string, string> = { "x-oms-user": username, ...(init.headers as any) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data as T;
}

export const fmtPaise = (p: number) =>
  (p < 0 ? "-" : "") + "₹" + (Math.abs(p || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export function shiftDate(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
export const fmtDateNice = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
