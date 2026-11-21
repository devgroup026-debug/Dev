"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import GlobalAddItem from "@/components/GlobalAddItem";
import GlobalTaskCreate from "@/components/GlobalTaskCreate";
import Footer from "@/components/Footer";
import WaExtensionSync from "@/components/WaExtensionSync";
// DISABLED (Urgent Tasks): import UrgentTaskPopup from "@/components/UrgentTaskPopup";
import { getPageTitle } from "@/lib/pageTitles";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";

  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false); // Prevents Hydration Error

  // Root layout is a client component (see hydration-guard comment below),
  // so the Next.js Metadata API (Server Component-only) can't set <title>
  // per route here - set document.title imperatively instead, on every
  // pathname change, so each dashboard section gets its own Chrome tab
  // title instead of every tab reading the same URL-derived text.
  useEffect(() => {
    document.title = getPageTitle(pathname);
  }, [pathname]);

  useEffect(() => {
    setIsMounted(true); // Tell React we are now safely in the browser

    const user = localStorage.getItem("oms_user");

    if (isLoginPage) {
      setIsLoading(false);
      return;
    }

    if (!user) {
      router.push("/login");
    } else {
      setIsLoading(false);
      // Site-visit-triggered background jobs. Each one is also throttled
      // server-side, but this used to fire all five on EVERY full page load
      // in every tab - each one a Vercel function invocation (cold start +
      // Mongo connect) even when the server just answered "not due yet".
      // A per-browser timestamp (localStorage, so shared across tabs) skips
      // the call entirely until the job could actually be due again.
      const runIfDue = (url: string, minIntervalMs: number, label: string) => {
        const key = `oms_bgjob_last:${url}`;
        try {
          const last = Number(localStorage.getItem(key) || 0);
          if (Date.now() - last < minIntervalMs) return;
          localStorage.setItem(key, String(Date.now()));
        } catch {
          /* storage unavailable - fall through and just call it */
        }
        fetch(url, { method: "POST" }).catch((err) => console.error(`${label} check failed silently:`, err));
      };
      const MIN = 60 * 1000;
      // Daily backup / yesterday's courier-tracking run (both once-a-day server-side)
      runIfDue("/api/backup/auto", 60 * MIN, "Auto backup");
      runIfDue("/api/courier/auto", 60 * MIN, "Courier auto-run");
      // Permanently remove any GeM bid past its 7-day Deleted Bids window
      runIfDue("/api/gem-bids/purge-deleted", 6 * 60 * MIN, "GeM bid purge");
      // Moves any GeM bid past its own end date into Expired Bids, and
      // purges any already past its 7-day window there (server: every 15 min)
      runIfDue("/api/gem-bids/expire-and-purge", 15 * MIN, "GeM bid expire-and-purge");
      // Queues a Bid Document fetch for any Bids to Fill/Submitted Bids bid
      // that doesn't have one, then auto-fetches its embedded Specification
      // link (server: every 5 min, see autoDocLinksJob.ts)
      runIfDue("/api/gem-bids/auto-doc-links", 5 * MIN, "GeM bid auto-doc-links");
    }
  }, [isLoginPage, router]);

  // If not mounted, return an empty body to match the server's initial HTML
  if (!isMounted) {
    return (
      <html lang="en">
        <head>
          {/* This layout is a Client Component (see the hydration-guard note
              above document.title), so Next's Metadata API can't supply a
              viewport export here - without this tag, mobile browsers assume
              a ~980px desktop-width canvas and let the whole page pan/zoom
              sideways instead of reflowing to the real screen width. */}
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        </head>
        <body className="bg-[#f3f6f9]" suppressHydrationWarning>
          {/* Empty or a static splash screen to match the server */}
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className="bg-[#f3f6f9] h-dvh overflow-hidden" suppressHydrationWarning>
        {isLoading && !isLoginPage ? (
          <div className="h-dvh flex items-center justify-center bg-[#f3f6f9]">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-blue-600"></div>
          </div>
        ) : !isLoginPage ? (
          <div className="flex flex-col h-full">
            <Header />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
            <Footer />
            {/* DISABLED (Urgent Tasks) - uncomment to re-enable: <UrgentTaskPopup /> */}
            <GlobalTaskCreate />
            <GlobalAddItem />
            {/* Writes DEV WA Bulk Sender extension send results back to the DB */}
            <WaExtensionSync />
          </div>
        ) : (
          <main className="h-full">{children}</main>
        )}
      </body>
    </html>
  );
}