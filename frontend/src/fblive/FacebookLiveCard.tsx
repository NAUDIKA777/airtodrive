import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { isScreenCaptureAvailable } from "@/modules/usb-screen-capture";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { liveCapture, useLiveCapture } from "@/src/fblive/liveCapture";
import { mono } from "@/src/fonts";
import type { DriveInfo } from "@/src/services/drive";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const AUDIO_LABEL: Record<string, string> = {
  pending: "audio: checking…",
  app: "audio: app sound",
  microphone: "audio: microphone",
  none: "audio: none",
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Home-tab control: record the screen (Facebook Live broadcast) straight to USB. */
export function FacebookLiveCard({ drive }: { drive: DriveInfo }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const live = useLiveCapture();
  const [now, setNow] = useState(() => Date.now());

  // Surface capture results (file saved, mic fallback, errors) as toasts.
  useEffect(() => liveCapture.onNotice((n) => toast.show(n.message, n.kind)), [toast]);

  useEffect(() => {
    if (live.phase !== "capturing") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live.phase]);

  if (!isScreenCaptureAvailable) return null;

  const capturing = live.phase === "capturing";
  const busy = live.phase === "starting" || live.phase === "stopping";
  const simulated = drive.simulated;

  const onPress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      if (capturing) await liveCapture.stop();
      else await liveCapture.start(drive);
    } catch (e: any) {
      toast.show(e?.message || "Could not start screen recording", "error");
    }
  };

  const label =
    live.phase === "starting"
      ? "STARTING…"
      : live.phase === "stopping"
        ? "FINALIZING ON USB…"
        : capturing
          ? "STOP RECORDING"
          : "GO LIVE + RECORD TO USB";

  return (
    <View style={[styles.card, capturing && { borderColor: colors.error }]} testID="fb-live-card">
      <View style={styles.top}>
        <View style={[styles.iconWrap, capturing && styles.iconWrapLive]}>
          <Icon name="facebook" size={22} color={capturing ? colors.error : colors.info} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Facebook Live → USB</Text>
          <Text style={styles.body}>
            {capturing
              ? "Recording your screen to the drive. Go live in Facebook, then come back and tap stop."
              : "Records your Facebook Live screen straight onto the USB drive — nothing saved on the phone."}
          </Text>
        </View>
      </View>

      {capturing ? (
        <View style={styles.statusRow} testID="fb-live-status">
          <View style={styles.recDot} />
          <Text style={styles.statusText}>REC {formatElapsed(now - (live.startedAt ?? now))}</Text>
          <Text style={styles.statusMeta} numberOfLines={1}>
            {AUDIO_LABEL[live.audioSource] ?? ""} · {live.fileName}
          </Text>
        </View>
      ) : null}

      <Pressable
        testID="fb-live-button"
        onPress={onPress}
        disabled={busy || simulated}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: capturing ? colors.error : colors.info },
          (busy || simulated) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Icon name={capturing ? "stop-circle-outline" : "broadcast"} size={18} color="#FFFFFF" />
        <Text style={styles.btnText}>{label}</Text>
      </Pressable>

      {simulated ? <Text style={styles.hint}>Needs a real USB drive (not the simulated one).</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  flex: { flex: 1 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: "rgba(10,132,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapLive: { backgroundColor: "rgba(255,69,58,0.16)" },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "700", fontFamily: mono },
  body: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  statusText: { color: colors.error, fontSize: 12, fontFamily: mono, fontWeight: "800" },
  statusMeta: { flex: 1, color: colors.muted, fontSize: 11, fontFamily: mono },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  btnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", fontFamily: mono, letterSpacing: 0.5 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  hint: { color: colors.warning, fontSize: 11, fontFamily: mono },
}));
