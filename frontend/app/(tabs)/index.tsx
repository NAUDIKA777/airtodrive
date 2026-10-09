import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/src/components/icon";
import { ProgressBar } from "@/src/components/progress-bar";
import { ScreenHeader } from "@/src/components/screen-header";
import { SegmentedControl } from "@/src/components/segmented";
import { useToast } from "@/src/components/toast";
import { mono } from "@/src/fonts";
import {
  useConnectDrive,
  useDisconnectDrive,
  useDriveFiles,
  useDriveStatus,
  useDriveUsage,
} from "@/src/hooks/useDrive";
import { useSamples, resolveMedia, looksDirectMedia, type SampleSource } from "@/src/services/api";
import { DRIVE_CAPACITY } from "@/src/services/drive";
import {
  formatBytes,
  formatSpeed,
  iconForKind,
  kindFromMime,
  mimeFromName,
  type FileKind,
  type TransferSource,
} from "@/src/services/media";
import { runTransfer, type Progress } from "@/src/services/transfer";
import { makeStyles, radius, spacing } from "@/src/theme";
import { useTheme } from "@/src/theme";
import { useQueryClient } from "@tanstack/react-query";

interface PendingItem {
  name: string;
  mimeType: string;
  kind: FileKind;
  size: number;
  url?: string;
  assetUri?: string;
}

function nameFromUrl(url: string): string {
  try {
    const clean = url.split("?")[0].split("#")[0];
    const last = clean.substring(clean.lastIndexOf("/") + 1);
    return last || "download.bin";
  } catch {
    return "download.bin";
  }
}

export default function TransferScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const { data: drive } = useDriveStatus();
  const { data: usage } = useDriveUsage();
  const { data: files } = useDriveFiles();
  const connect = useConnectDrive();
  const disconnect = useDisconnectDrive();
  const samplesQ = useSamples();

  const [source, setSource] = useState<TransferSource>("internet");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<PendingItem | null>(null);
  const [compress, setCompress] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const connected = !!drive;

  const handleConnect = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const info = await connect.mutateAsync();
      toast.show(info.simulated ? "Simulated drive connected" : "USB drive connected", "success");
    } catch {
      toast.show("Could not connect drive", "error");
    }
  }, [connect, toast]);

  const pickSample = useCallback((s: SampleSource) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setUrl(s.url);
    setPending({ name: s.name, mimeType: s.mimeType, kind: s.kind, size: s.size, url: s.url });
  }, []);

  const onUrlChange = useCallback((t: string) => {
    setUrl(t);
    const trimmed = t.trim();
    if (trimmed) {
      const name = nameFromUrl(trimmed);
      const mime = mimeFromName(name);
      setPending({ name, mimeType: mime, kind: kindFromMime(mime, name), size: 0, url: trimmed });
    } else {
      setPending(null);
    }
  }, []);

  const pickMedia = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          toast.show("Enable photo access in Settings", "error");
          Linking.openSettings().catch(() => {});
        } else {
          toast.show("Photo library access is needed", "info");
        }
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1 });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      const name = a.fileName ?? nameFromUrl(a.uri);
      const mime = a.mimeType ?? mimeFromName(name);
      setPending({
        name,
        mimeType: mime,
        kind: kindFromMime(mime, name),
        size: a.fileSize ?? 0,
        assetUri: a.uri,
      });
      if (Platform.OS !== "web") Haptics.selectionAsync();
    } catch {
      toast.show("Could not open the media picker", "error");
    }
  }, [toast]);

  const pickDoc = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["audio/*", "text/*", "application/json", "application/pdf", "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      const mime = a.mimeType ?? mimeFromName(a.name);
      setPending({
        name: a.name,
        mimeType: mime,
        kind: kindFromMime(mime, a.name),
        size: a.size ?? 0,
        assetUri: a.uri,
      });
      if (Platform.OS !== "web") Haptics.selectionAsync();
    } catch {
      toast.show("Could not open the file picker", "error");
    }
  }, [toast]);

  const doTransfer = useCallback(
    async (item: PendingItem, src: TransferSource) => {
      if (!drive) return;
      abortRef.current = { aborted: false };
      setRunning(true);
      setProgress(null);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      try {
        await runTransfer({
          url: item.url,
          assetUri: item.assetUri,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size || undefined,
          source: src,
          compress,
          driveInfo: drive,
          onProgress: setProgress,
          signal: abortRef.current,
        });
        toast.show(`Streamed ${item.name} to drive`, "success");
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["drive-usage"] });
        setPending(null);
        setUrl("");
      } catch (e: any) {
        const cancelled = String(e?.message || e).toLowerCase().includes("cancel");
        toast.show(cancelled ? "Transfer cancelled" : "Transfer failed", cancelled ? "info" : "error");
      } finally {
        setRunning(false);
      }
    },
    [drive, compress, toast, qc],
  );

  const start = useCallback(async () => {
    if (!pending) return;
    let item = pending;
    // Internet links that aren't a direct media file get resolved server-side so
    // we stream the real video, never a webpage's raw HTML source.
    if (source === "internet" && pending.url && !looksDirectMedia(pending.url)) {
      setRunning(true);
      setProgress({
        phase: "connecting",
        bytesWritten: 0,
        totalBytes: -1,
        bytesPerSec: 0,
        compressed: false,
        message: "Resolving media URL\u2026",
      });
      try {
        const r = await resolveMedia(pending.url);
        item = { name: r.name, mimeType: r.mimeType, kind: r.kind, size: 0, url: r.url };
        setPending(item);
        if (r.resolved) toast.show(`Found ${r.name}`, "info");
      } catch (e: any) {
        setRunning(false);
        setProgress(null);
        toast.show(String(e?.message || "No video found on that page"), "error");
        return;
      }
    }
    await doTransfer(item, source);
  }, [pending, source, doTransfer, toast]);

  const cancel = useCallback(() => {
    abortRef.current.aborted = true;
  }, []);

  const canStart = connected && !running && !!pending;
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(1, progress.bytesWritten / progress.totalBytes)
      : progress?.phase === "done"
        ? 1
        : 0;
  const usedPct = usage ? Math.min(1, usage.used / DRIVE_CAPACITY) : 0;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Transfer"
        subtitle="Stream data straight to USB"
        right={
          connected ? (
            <Pressable
              testID="disconnect-button"
              onPress={() => disconnect.mutate()}
              hitSlop={8}
              style={styles.eject}
            >
              <Icon name="eject" size={16} color={colors.error} />
              <Text style={styles.ejectText}>EJECT</Text>
            </Pressable>
          ) : null
        }
      />

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
      >
        {/* Drive status */}
        {connected ? (
          <View style={styles.driveCard} testID="drive-status-card">
            <View style={styles.driveTop}>
              <View style={styles.driveIcon}>
                <Icon name="usb-flash-drive" size={22} color={colors.brandPrimary} />
              </View>
              <View style={styles.flex}>
                <View style={styles.driveNameRow}>
                  <Text style={styles.driveName}>{drive!.name}</Text>
                  {drive!.simulated ? (
                    <View style={styles.simBadge}>
                      <Text style={styles.simBadgeText}>SIM</Text>
                    </View>
                  ) : (
                    <View style={[styles.simBadge, styles.liveBadge]}>
                      <Text style={[styles.simBadgeText, styles.liveBadgeText]}>LIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.driveMeta}>
                  {formatBytes(usage?.used ?? 0)} used · {usage?.count ?? files?.length ?? 0} files
                </Text>
              </View>
            </View>
            <ProgressBar progress={usedPct} color={colors.brandSecondary} height={5} />
            <Text style={styles.capacity}>
              {formatBytes(usage?.used ?? 0)} / {formatBytes(DRIVE_CAPACITY)}
            </Text>
          </View>
        ) : (
          <View style={styles.connectCard} testID="connect-empty">
            <View style={styles.connectIcon}>
              <Icon name="usb-port" size={34} color={colors.brandPrimary} />
            </View>
            <Text style={styles.connectTitle}>No USB drive connected</Text>
            <Text style={styles.connectBody}>
              Plug in an external USB drive and select it. All incoming data streams directly to the
              drive — nothing is stored on the phone.
            </Text>
            <Pressable
              testID="connect-button"
              onPress={handleConnect}
              disabled={connect.isPending}
              style={({ pressed }) => [styles.connectBtn, pressed && styles.pressed]}
            >
              <Icon name="usb" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.connectBtnText}>
                {connect.isPending ? "CONNECTING…" : "CONNECT USB DRIVE"}
              </Text>
            </Pressable>
          </View>
        )}

        {connected ? (
          <>
            {/* Source toggle */}
            <Text style={styles.sectionLabel}>DATA SOURCE</Text>
            <SegmentedControl
              testID="source-toggle"
              value={source}
              onChange={(v) => {
                setSource(v);
                setPending(null);
                setUrl("");
              }}
              options={[
                { value: "internet", label: "INTERNET" },
                { value: "local", label: "PHONE MEDIA" },
              ]}
            />

            {/* Source input */}
            {source === "internet" ? (
              <View style={styles.block}>
                <TextInput
                  testID="url-input"
                  value={url}
                  onChangeText={onUrlChange}
                  placeholder="https://example.com/file.mp4"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={styles.input}
                  editable={!running}
                />
                <Text style={styles.hint}>Sample sources</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {samplesQ.data?.map((s) => {
                    const active = pending?.url === s.url;
                    return (
                      <Pressable
                        key={s.name}
                        testID={`sample-${s.name}`}
                        onPress={() => pickSample(s)}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Icon
                          name={iconForKind(s.kind)}
                          size={14}
                          color={active ? colors.onBrandPrimary : colors.brandPrimary}
                        />
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {s.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.block}>
                <View style={styles.pickRow}>
                  <PickButton icon="image-multiple-outline" label="Photos" onPress={pickMedia} disabled={running} styles={styles} colors={colors} testID="pick-media" />
                  <PickButton icon="file-outline" label="Files" onPress={pickDoc} disabled={running} styles={styles} colors={colors} testID="pick-doc" />
                  <PickButton icon="camera-outline" label="Camera" onPress={() => router.push("/camera")} disabled={running} styles={styles} colors={colors} testID="pick-camera" />
                </View>
              </View>
            )}

            {/* Selected item */}
            {pending ? (
              <View style={styles.selected} testID="selected-item">
                <Icon name={iconForKind(pending.kind)} size={18} color={colors.brandSecondary} />
                <View style={styles.flex}>
                  <Text style={styles.selectedName} numberOfLines={1}>
                    {pending.name}
                  </Text>
                  <Text style={styles.selectedMeta}>
                    {pending.kind.toUpperCase()}
                    {pending.size ? ` · ${formatBytes(pending.size)}` : ""}
                  </Text>
                </View>
                {!running ? (
                  <Pressable onPress={() => { setPending(null); setUrl(""); }} hitSlop={8} testID="clear-selection">
                    <Icon name="close-circle" size={20} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Compression toggle */}
            <View style={styles.compressRow} testID="compress-row">
              <View style={styles.flex}>
                <Text style={styles.compressTitle}>On-the-fly compression</Text>
                <Text style={styles.compressSub}>gzip text & data · media passes through</Text>
              </View>
              <Switch
                testID="compress-switch"
                value={compress}
                onValueChange={setCompress}
                disabled={running}
                trackColor={{ true: colors.brandSecondary, false: colors.surfaceTertiary }}
                thumbColor={colors.onSurface}
              />
            </View>

            {/* Terminal console */}
            <Text style={styles.sectionLabel}>STREAM CONSOLE</Text>
            <View style={styles.console} testID="transfer-console">
              <View style={styles.consoleHeadRow}>
                <View style={[styles.statusDot, running ? styles.dotLive : styles.dotIdle]} />
                <Text style={styles.consolePhase}>
                  {progress ? progress.phase.toUpperCase() : running ? "WORKING" : "IDLE"}
                </Text>
                {progress?.compressed ? <Text style={styles.gzTag}>GZIP</Text> : null}
              </View>
              <View style={styles.consoleGrid}>
                <Metric label="WRITTEN" value={formatBytes(progress?.bytesWritten ?? 0)} styles={styles} />
                <Metric
                  label="TOTAL"
                  value={progress && progress.totalBytes > 0 ? formatBytes(progress.totalBytes) : "—"}
                  styles={styles}
                />
                <Metric label="SPEED" value={progress ? formatSpeed(progress.bytesPerSec) : "0 B/s"} styles={styles} />
              </View>
              <ProgressBar progress={pct} testID="transfer-progress" />
              <Text style={styles.consoleLine} numberOfLines={1}>
                {progress ? `> ${progress.message}` : "> awaiting source…  route: SAF → USB"}
              </Text>
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Sticky CTA */}
      {connected ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          {running ? (
            <Pressable testID="cancel-button" onPress={cancel} style={({ pressed }) => [styles.cta, styles.ctaCancel, pressed && styles.pressed]}>
              <Icon name="stop-circle-outline" size={20} color={colors.onError} />
              <Text style={[styles.ctaText, { color: colors.onError }]}>CANCEL STREAM</Text>
            </Pressable>
          ) : (
            <Pressable
              testID="start-button"
              onPress={start}
              disabled={!canStart}
              style={({ pressed }) => [styles.cta, !canStart && styles.ctaDisabled, pressed && styles.pressed]}
            >
              <Icon name="play-circle" size={20} color={canStart ? colors.onBrandPrimary : colors.muted} />
              <Text style={[styles.ctaText, !canStart && styles.ctaTextDisabled]}>START STREAM</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value, styles }: { label: string; value: string; styles: any }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function PickButton({
  icon,
  label,
  onPress,
  disabled,
  styles,
  colors,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled: boolean;
  styles: any;
  colors: any;
  testID: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.pickBtn, pressed && styles.pressed]}>
      <Icon name={icon} size={22} color={colors.brandPrimary} />
      <Text style={styles.pickLabel}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["2xl"] },

  eject: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.error },
  ejectText: { color: colors.error, fontSize: 11, fontFamily: mono, fontWeight: "700" },

  driveCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  driveTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  driveIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  driveNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  driveName: { color: colors.onSurface, fontSize: 16, fontWeight: "700", fontFamily: mono },
  driveMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  simBadge: { backgroundColor: "rgba(245,158,11,0.18)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  simBadgeText: { color: colors.warning, fontSize: 10, fontFamily: mono, fontWeight: "700" },
  liveBadge: { backgroundColor: "rgba(16,185,129,0.18)" },
  liveBadgeText: { color: colors.brandSecondary },
  capacity: { color: colors.muted, fontSize: 11, fontFamily: mono },

  connectCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, alignItems: "center", gap: spacing.md },
  connectIcon: { width: 72, height: 72, borderRadius: radius.lg, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  connectTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  connectBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  connectBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.xs },
  connectBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "800", fontFamily: mono, letterSpacing: 0.5 },

  sectionLabel: { color: colors.muted, fontSize: 11, fontFamily: mono, letterSpacing: 2, marginTop: spacing.xs },

  block: { gap: spacing.sm },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 14, fontFamily: mono },
  hint: { color: colors.muted, fontSize: 11, fontFamily: mono, marginTop: spacing.xs },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.lg },
  chip: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontFamily: mono },
  chipTextActive: { color: colors.onBrandPrimary, fontWeight: "700" },

  pickRow: { flexDirection: "row", gap: spacing.sm },
  pickBtn: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.lg, minHeight: 92 },
  pickLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontFamily: mono },

  selected: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.md },
  selectedName: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  selectedMeta: { color: colors.muted, fontSize: 11, fontFamily: mono, marginTop: 2 },

  compressRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  compressTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  compressSub: { color: colors.muted, fontSize: 11, fontFamily: mono, marginTop: 2 },

  console: { backgroundColor: "#060607", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  consoleHeadRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotLive: { backgroundColor: colors.brandSecondary },
  dotIdle: { backgroundColor: colors.muted },
  consolePhase: { color: colors.brandPrimary, fontSize: 12, fontFamily: mono, fontWeight: "700", letterSpacing: 1 },
  gzTag: { color: colors.warning, fontSize: 10, fontFamily: mono, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  consoleGrid: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  metric: { flex: 1 },
  metricLabel: { color: colors.muted, fontSize: 9, fontFamily: mono, letterSpacing: 1 },
  metricValue: { color: colors.onSurface, fontSize: 15, fontFamily: mono, fontWeight: "700", marginTop: 2 },
  consoleLine: { color: colors.brandSecondary, fontSize: 11, fontFamily: mono },

  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, minHeight: 54 },
  ctaCancel: { backgroundColor: colors.error },
  ctaDisabled: { backgroundColor: colors.surfaceTertiary },
  ctaText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800", fontFamily: mono, letterSpacing: 1 },
  ctaTextDisabled: { color: colors.muted },
  pressed: { opacity: 0.85 },
}));
