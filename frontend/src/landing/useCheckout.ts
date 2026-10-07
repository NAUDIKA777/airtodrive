import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

const API = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export interface CheckoutConfig {
  enabled: boolean;
  product: string;
  amount_display: string;
  currency: string;
}

async function fetchConfig(): Promise<CheckoutConfig> {
  const r = await fetch(`${API}/api/checkout/config`);
  if (!r.ok) throw new Error("config");
  return r.json();
}

export function useCheckoutConfig() {
  return useQuery({ queryKey: ["checkout-config"], queryFn: fetchConfig });
}

export function useBuy(onError: (msg: string) => void) {
  const [busy, setBusy] = useState(false);

  const buy = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (r.status === 503) {
        onError("Checkout isn't live yet — add your Stripe key to enable purchases.");
        return;
      }
      if (!r.ok) throw new Error("Could not start checkout");
      const { checkout_url } = await r.json();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(checkout_url);
      } else {
        onError("Checkout opens on the web version.");
      }
    } catch (e: any) {
      onError(e?.message || "Checkout failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [onError]);

  return { busy, buy };
}
