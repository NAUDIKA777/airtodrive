import Slider from "@react-native-community/slider";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/icon";
import { ProgressBar } from "@/src/components/progress-bar";
import { useToast } from "@/src/components/toast";
import { mono } from "@/src/fonts";
import { useDriveStatus } from "@/src/hooks/useDrive";
import type { DriveInfo } from "@/src/services/drive";
import { formatBytes } from "@/src/services/media";
import { runTransfer, type Progress } from "@/src/services/transfer";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Load VisionCamera defensively — it's a native module that is absent in Expo Go
// / web, so we fall back to an "unavailable" message instead of crashing.
let VC: any = null;
try {
  VC = require("react-native-vision-camera");
} catch {
  VC = null;
}

export function VisionRecorder() {
  if (!VC?.Camera) return <Unavailable reason="missing" />;
  return <Recorder vc={VC} />;
}

function Recorder({ vc }: { vc: any }) {
  const { Camera, useCameraDevice, useCameraPermission, useMicrophonePermission, useCameraFormat } = vc;
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [isFocused, setIsFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  const { data: driveInfo } = useDriveStatus();
  const driveRef = useRef<DriveInfo | null | undefined>(driveInfo);
  driveRef.current = driveInfo;

  const { hasPermission: hasCam, requestPermission: reqCam } = useCameraPermission();
  const { hasPermission: hasMic, requestPermission: reqMic } = useMicrophonePermission();

  const [position, setPosition] = useState<"back" | "front">("back");
  const [torch, setTorch] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [recording, setRecording] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const cameraRef = useRef<any>(null);

  const device = useCameraDevice(position);
  const targetFps = slowMo ? 120 : 30;
  const format = useCameraFormat(device, [{ videoResolution: "max" }, { fps: targetFps }]);
  const fps = format ? Math.min(targetFps, format.maxFps ?? targetFps) : targetFps;

  useEffect(() => {
    if (!hasCam) reqCam();
    if (!hasMic) reqMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (device) setZoom(device.neutralZoom ?? 1);
  }, [device]);

  // Pulsing glow while recording.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (recording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
  }, [recording, pulse]);

  const streamToDrive = useCallback(
    async (path: string, name: string, mimeType: string) => {
      const drive = driveRef.current;
      if (!drive) {
        toast.show("Connect a USB drive first", "error");
        return;
      }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      setStreaming(true);
      try {
        // runTransfer opens a writable stream to the USB path and closes it when
        // done — i.e. the write stream is ended/closed here, not left dangling.
        await runTransfer({
          assetUri: uri,
          name,
          mimeType,
          source: "local",
          compress: false,
          driveInfo: drive,
          onProgress: setProgress,
        });
        toast.show(`Streamed ${name} to USB`, "success");
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["drive-usage"] });
        // Remove the camera's temp capture so nothing lingers in internal storage.
        try {
          const { File } = require("expo-file-system");
          const tmp = new File(uri);
          if (tmp.exists) tmp.delete();
        } catch {
          // best-effort cleanup
        }
      } catch {
        toast.show("Could not stream capture to USB", "error");
      } finally {
        setStreaming(false);
        setProgress(null);
      }
    },
    [toast, qc],
  );

  const onToggleRecord = useCallback(async () => {
    if (!driveRef.current) {
      toast.show("Connect a USB drive first", "error");
      return;
    }
    if (recording) {
      // Stopping ends recording -> onRecordingFinished fires -> stream closes ->
      // record state resets below and in the callback.
      try {
        await cameraRef.current?.stopRecording();
      } catch {
        // ignore
      }
      setRecording(false);
      return;
    }
    try {
      cameraRef.current?.startRecording({
        fileType: "mp4",
        onRecordingFinished: (video: { path: string }) => {
          setRecording(false);
          streamToDrive(video.path, `REC_${Date.now()}.mp4`, "video/mp4");
        },
        onRecordingError: () => {
          setRecording(false);
          toast.show("Recording failed", "error");
        },
      });
      setRecording(true);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      toast.show("Could not start recording", "error");
    }
  }, [recording, streamToDrive, toast]);

  const takePhoto = useCallback(async () => {
    if (recording) return;
    if (!driveRef.current) {
      toast.show("Connect a USB drive first", "error");
      return;
    }
    try {
      const photo = await cameraRef.current?.takePhoto({ flash: torch ? "on" : "off" });
      if (photo?.path) {
        if (Platform.OS !== "web") Haptics.selectionAsync();
        await streamToDrive(photo.path, `IMG_${Date.now()}.jpg`, "image/jpeg");
      }
    } catch {
      toast.show("Could not capture photo", "error");
    }
  }, [recording, torch, streamToDrive, toast]);

  // ---- permission / device gates ----
  if (!hasCam) {
    return (
      <Gate
        icon="camera-off-outline"
        title="Camera access needed"
        body="Air to Drive records straight to your USB drive — grant camera access to start."
        actionLabel="GRANT ACCESS"
        onAction={async () => {
          const ok = await reqCam();
          if (!ok) Linking.openSettings().catch(() => {});
        }}
        onBack={() => router.back()}
      />
    );
  }
  if (!device) {
    return <Unavailable reason="no-device" onBack={() => router.back()} />;
  }

  const haloColor = recording ? colors.error : colors.brandSecondary;
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const busy = streaming;

  const cameraProps: any = {
    ref: cameraRef,
    style: StyleSheet.absoluteFill,
    device,
    isActive: isFocused,
    video: true,
    audio: true,
    photo: true,
    torch: torch ? "on" : "off",
    zoom,
  };
  if (format) {
    cameraProps.format = format;
    if (slowMo) cameraProps.fps = fps;
  }

  return (
    <View style={styles.container}>
      <Camera {...cameraProps} />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="camera-back" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <Icon name="chevron-left" size={28} color="#FFFFFF" />
        </Pressable>
        <View style={styles.driveTag}>
          <Icon
            name={driveInfo ? "usb-flash-drive" : "usb-port"}
            size={14}
            color={driveInfo ? colors.brandSecondary : colors.warning}
          />
          <Text style={styles.driveTagText} numberOfLines={1}>
            {driveInfo ? driveInfo.name : "No drive"}
          </Text>
        </View>
        {recording ? (
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recPillText}>REC</Text>
          </View>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {/* Right-side manual controls */}
      <View style={[styles.sideRail, { top: insets.top + 72 }]}>
        <RailButton
          icon="camera-flip-outline"
          active={position === "front"}
          disabled={recording}
          onPress={() => setPosition((p) => (p === "back" ? "front" : "back"))}
          styles={styles}
          colors={colors}
          testID="camera-flip"
        />
        <RailButton
          icon={torch ? "flashlight" : "flashlight-off"}
          active={torch}
          onPress={() => setTorch((t) => !t)}
          styles={styles}
          colors={colors}
          testID="camera-torch"
        />
        <RailButton
          icon="motion-outline"
          active={slowMo}
          disabled={recording}
          onPress={() => setSlowMo((s) => !s)}
          styles={styles}
          colors={colors}
          label={slowMo ? `${fps}fps` : undefined}
          testID="camera-slowmo"
        />
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        {busy ? (
          <View style={styles.streamBox} testID="camera-streaming">
            <Text style={styles.streamText} numberOfLines={1}>
              {progress ? `> ${progress.message}` : "> streaming \u2192 USB"}
            </Text>
            <ProgressBar
              progress={
                progress && progress.totalBytes > 0
                  ? Math.min(1, progress.bytesWritten / progress.totalBytes)
                  : progress?.phase === "done"
                    ? 1
                    : 0
              }
            />
            <Text style={styles.streamMeta}>{formatBytes(progress?.bytesWritten ?? 0)} written</Text>
          </View>
        ) : null}

        {/* Zoom */}
        <View style={styles.zoomRow}>
          <Icon name="magnify-minus-outline" size={18} color="#FFFFFF" />
          <Slider
            testID="camera-zoom"
            style={styles.zoomSlider}
            minimumValue={device.minZoom ?? 1}
            maximumValue={Math.min(device.maxZoom ?? 8, 8)}
            value={zoom}
            onValueChange={setZoom}
            minimumTrackTintColor={colors.brandPrimary}
            maximumTrackTintColor="rgba(255,255,255,0.35)"
            thumbTintColor={colors.brandPrimary}
          />
          <Icon name="magnify-plus-outline" size={18} color="#FFFFFF" />
        </View>

        <View style={styles.shutterRow}>
          <RailButton
            icon="camera-outline"
            disabled={recording || busy}
            onPress={takePhoto}
            styles={styles}
            colors={colors}
            testID="camera-photo"
          />

          {/* Glowing Record-to-Drive button */}
          <View style={styles.recordWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                { backgroundColor: haloColor, transform: [{ scale: haloScale }], opacity: haloOpacity },
              ]}
            />
            <Pressable
              testID="record-to-drive"
              onPress={onToggleRecord}
              disabled={busy}
              style={[
                styles.recordBtn,
                {
                  borderColor: recording ? colors.error : colors.brandSecondary,
                  shadowColor: recording ? colors.error : colors.brandSecondary,
                },
                busy && styles.recordDisabled,
              ]}
            >
              <View
                style={[
                  recording ? styles.recInnerStop : styles.recInnerIdle,
                  { backgroundColor: recording ? colors.error : colors.brandSecondary },
                ]}
              />
            </Pressable>
          </View>

          <View style={styles.railSpacer} />
        </View>

        <Text style={styles.recordLabel}>{recording ? "Recording to Drive…" : "Record to Drive"}</Text>
      </View>
    </View>
  );
}

function RailButton({
  icon,
  active,
  disabled,
  onPress,
  label,
  styles,
  colors,
  testID,
}: {
  icon: any;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  label?: string;
  styles: any;
  colors: any;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[styles.rail, active && styles.railActive, disabled && styles.railDisabled]}
    >
      <Icon name={icon} size={20} color={active ? colors.onBrandPrimary : "#FFFFFF"} />
      {label ? <Text style={styles.railLabel}>{label}</Text> : null}
    </Pressable>
  );
}

function Gate({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  onBack,
}: {
  icon: any;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.gate, { paddingTop: insets.top }]}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.gateBack}>
        <Icon name="chevron-left" size={28} color={colors.onSurface} />
      </Pressable>
      <View style={styles.gateBody}>
        <Icon name={icon} size={48} color={colors.brandPrimary} />
        <Text style={styles.gateTitle}>{title}</Text>
        <Text style={styles.gateText}>{body}</Text>
        <Pressable onPress={onAction} style={styles.gateBtn}>
          <Text style={styles.gateBtnText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Unavailable({ reason, onBack }: { reason: "missing" | "no-device"; onBack?: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.gate, { paddingTop: insets.top }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} style={styles.gateBack}>
          <Icon name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
      ) : null}
      <View style={styles.gateBody}>
        <Icon name={reason === "no-device" ? "camera-off-outline" : "cellphone-cog"} size={48} color={colors.muted} />
        <Text style={styles.gateTitle}>
          {reason === "no-device" ? "No camera found" : "Camera needs a native build"}
        </Text>
        <Text style={styles.gateText}>
          {reason === "no-device"
            ? "This device has no usable camera."
            : "The Record-to-Drive camera runs on a real Android/iOS build — not in Expo Go or the web preview."}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: "#000000" },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  driveTag: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    maxWidth: 180,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  driveTagText: { color: "#FFFFFF", fontSize: 11, fontFamily: mono },
  recPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(239,68,68,0.9)",
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.pill,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  recPillText: { color: "#FFFFFF", fontSize: 11, fontFamily: mono, fontWeight: "800" },

  sideRail: { position: "absolute", right: spacing.md, gap: spacing.md, zIndex: 10 },
  rail: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  railActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  railDisabled: { opacity: 0.4 },
  railLabel: { color: "#FFFFFF", fontSize: 8, fontFamily: mono, marginTop: 1 },
  railSpacer: { width: 46 },

  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  streamBox: {
    backgroundColor: "rgba(6,6,7,0.85)",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  streamText: { color: colors.brandSecondary, fontSize: 12, fontFamily: mono },
  streamMeta: { color: colors.muted, fontSize: 10, fontFamily: mono },

  zoomRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  zoomSlider: { flex: 1, height: 36 },

  shutterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recordWrap: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 96, height: 96, borderRadius: 48 },
  recordBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 16,
    elevation: 16,
  },
  recordDisabled: { opacity: 0.5 },
  recInnerIdle: { width: 56, height: 56, borderRadius: 28 },
  recInnerStop: { width: 32, height: 32, borderRadius: 8 },
  recordLabel: { color: "#FFFFFF", fontSize: 13, fontFamily: mono, fontWeight: "700", textAlign: "center", letterSpacing: 0.5 },

  gate: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  gateBack: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  gateBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingBottom: spacing["3xl"] },
  gateTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" },
  gateText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center", paddingHorizontal: spacing.md },
  gateBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  gateBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "800", fontFamily: mono, letterSpacing: 0.5 },
}));
