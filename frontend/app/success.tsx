import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/icon";
import { mono } from "@/src/fonts";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const API = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

type Result = { paid: boolean; payment_status: string; order_status: string; amount_display?: string };

export default function SuccessScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();

  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const attempt = useRef(0);

  useEffect(() => {
    if (!session_id) {
      setError("Missing checkout session.");
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${API}/api/checkout/status?session_id=${encodeURIComponent(String(session_id))}`);
        if (!r.ok) throw new Error("Unable to verify payment.");
        const data: Result = await r.json();
        if (cancelled) return;
        setResult(data);
        if (!data.paid && attempt.current++ < 10) setTimeout(poll, 1500);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Verification failed.");
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [session_id]);

  const paid = result?.paid;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.card}>
        {error ? (
          <>
            <View style={[styles.badge, { borderColor: colors.error }]}>
              <Icon name="alert-circle-outline" size={40} color={colors.error} />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.body}>{error}</Text>
          </>
        ) : !result ? (
          <>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
            <Text style={styles.title}>Verifying payment…</Text>
            <Text style={styles.body}>Confirming your purchase with Stripe. This only takes a moment.</Text>
          </>
        ) : paid ? (
          <>
            <View style={[styles.badge, { borderColor: colors.brandSecondary }]}>
              <Icon name="check-decagram" size={44} color={colors.brandSecondary} />
            </View>
            <Text style={styles.title}>Payment successful</Text>
            <Text style={styles.body}>
              Your {result.amount_display ?? ""} Lifetime Access to Air to Drive is active. Thank you —
              every future update is included.
            </Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.warning} />
            <Text style={styles.title}>Payment processing</Text>
            <Text style={styles.body}>Status: {result.payment_status}. We're still waiting for confirmation.</Text>
          </>
        )}

        <Pressable testID="success-home" onPress={() => router.replace("/")} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
          <Icon name="arrow-left" size={16} color={colors.onBrandPrimary} />
          <Text style={styles.btnText}>Back to Air to Drive</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 440, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing["2xl"], alignItems: "center", gap: spacing.md },
  badge: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "#0A1418" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", marginTop: spacing.sm },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  btn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.lg },
  btnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "800", fontFamily: mono, letterSpacing: 0.5 },
}));
