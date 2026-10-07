import { useCallback, useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";

// Captures the browser's `beforeinstallprompt` event so we can trigger the
// native PWA install prompt from a button. Web-only; no-ops elsewhere.
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      // iOS Safari
      (window.navigator as any).standalone === true;
    if (standalone) setInstalled(true);

    const onBIP = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (deferred) {
      deferred.prompt();
      try {
        const choice = await deferred.userChoice;
        setDeferred(null);
        setCanInstall(false);
        return choice?.outcome ?? "dismissed";
      } catch {
        return "dismissed";
      }
    }
    return "unavailable";
  }, [deferred]);

  return { canInstall, installed, promptInstall };
}

const DISMISS_KEY = "pwa_prompt_dismissed";

export async function wasPromptDismissed(): Promise<boolean> {
  return (await storage.getItem<boolean>(DISMISS_KEY, false)) ?? false;
}

export async function setPromptDismissed(): Promise<void> {
  await storage.setItem(DISMISS_KEY, true as any);
}
