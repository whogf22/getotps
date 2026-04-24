import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type VersionPayload = {
  version: string;
  built_at: string;
  branch: string;
};

const DISMISS_KEY = "version_banner_dismissed_until";

export function VersionBanner() {
  const [current, setCurrent] = useState<VersionPayload | null>(null);
  const [latest, setLatest] = useState<VersionPayload | null>(null);
  const [dismissedUntil, setDismissedUntil] = useState<number>(() => Number(localStorage.getItem(DISMISS_KEY) || "0"));

  useEffect(() => {
    let mounted = true;
    const fetchVersion = async () => {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as VersionPayload;
      if (!mounted) return;
      setLatest(payload);
      setCurrent((prev) => prev ?? payload);
    };

    fetchVersion().catch(() => {});
    const interval = window.setInterval(() => {
      fetchVersion().catch(() => {});
    }, 5 * 60 * 1000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const shouldShow = useMemo(() => {
    if (!current || !latest) return false;
    if (Date.now() < dismissedUntil) return false;
    return current.version !== latest.version;
  }, [current, latest, dismissedUntil]);

  useEffect(() => {
    if (!shouldShow) return;
    const route = window.location.hash.replace(/^#/, "") || "/";
    const financialRoutes = ["/buy", "/active", "/funds", "/history"];
    if (!financialRoutes.some((p) => route.startsWith(p))) {
      const timer = window.setTimeout(() => window.location.reload(), 5000);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [shouldShow]);

  if (!shouldShow || !latest) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-primary text-primary-foreground px-4 py-2 shadow">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <p className="text-sm">✨ GetOTPs just updated! Refresh to get the latest version.</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Refresh Now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-primary-foreground hover:text-primary-foreground"
            onClick={() => {
              const until = Date.now() + 30 * 60 * 1000;
              localStorage.setItem(DISMISS_KEY, String(until));
              setDismissedUntil(until);
            }}
          >
            Later
          </Button>
        </div>
      </div>
    </div>
  );
}
