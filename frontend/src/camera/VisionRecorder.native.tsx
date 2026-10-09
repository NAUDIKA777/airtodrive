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
import { recordStore } from "@/src/camera/recordStore";
import { mono } from "@/src/fonts";
import { useDriveStatus } from "@/src/hooks/useDrive";
import type { DriveInfo } from "@/src/services/drive";
import { formatBytes } from "@/src/services/media";
import {
  canRecordDirect,
  createDriveFile,
  deleteDriveFile,
  registerDriveFile,
  streamFileToDrive,
  type DriveTarget,
  type Progress,
} from "@/src/services/transfer";
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
  // VisionCamera v5 API: the Camera takes "outputs"; photos and videos are
  // captured through those outputs instead of methods on a Camera ref.
  const { Camera, useCameraDevice, useCameraPermission, useMicrophonePermission, useVideoOutput, usePhotoOutput } = vc;
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

  const recorderRef = useRef<any>(null); // active v5 Recorder
  const targetRef = useRef<DriveTarget | null>(null); // USB file being recorded into
  const signalRef = useRef<{ aborted: boolean }>({ aborted: false });

  const device = useCameraDevice(position);
  const fps = slowMo && device?.supportsFPS?.(120) ? 120 : 30;

  const videoOutput = useVideoOutput({ enableAudio: !!hasMic, fileType: "mp4" });
  const photoOutput = usePhotoOutput({});

  useEffect(() => {
    if (!hasCam) reqCam();
    if (!hasMic) reqMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (device) setZoom(Math.min(Math.max(1, device.minZoom ?? 1), device.maxZoom ?? 1));
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

  // Mirror state into the global store so the cross-screen overlay reflects it.
  useEffect(() => {
    recordStore.setRecording(recording);
  }, [recording]);
  useEffect(() => {
    recordStore.setStreaming(streaming);
  }, [streaming]);

  // Leaving the recorder: stop any live recording and abort the USB write stream
  // so nothing is left half-written, then clear the global overlay state.
  useEffect(() => {
    return () => {
      signalRef.current.aborted = true;
      // Stop (not cancel) so the footage already on the drive is kept;
      // the recorder's finish callback still indexes the file.
      const rec = recorderRef.current;
      if (rec?.isRecording) rec.stopRecording().catch(() => {});
      recordStore.reset();
    };
  }, []);

  const streamToDrive = useCallback(
    async (path: string, name: string, mimeType: string) => {
      const drive = driveRef.current;
      if (!drive) {
        toast.show("Connect a USB drive first", "error");
        return;
      }
      const uri = path.startsWith("file://") ? path : `file://${path}`;
      signalRef.current = { aborted: false };
      setStreaming(true);
      try {
        // Writes straight onto the mounted USB (SAF) path and explicitly closes
        // the write stream when done.
        await streamFileToDrive({
          srcUri: uri,
          name,
          mimeType,
          driveInfo: drive,
          onProgress: setProgress,
          signal: signalRef.current,
        });
        toast.show(`Saved ${name} to USB`, "success");
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["drive-usage"] });
      } catch (e: any) {
        const cancelled = String(e?.message || e).toLowerCase().includes("cancel");
        if (!cancelled) toast.show("Could not stream capture to USB", "error");
      } finally {
        // ALWAYS remove the camera's temp capture — success, error or cancel —
        // so a full-size video never lingers in internal storage.
        try {
          const { File } = require("expo-file-system");
          const tmp = new File(uri);
          if (tmp.exists) tmp.delete();
        } catch {
          // best-effort cleanup
        }
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
      // Stop: CameraX finalises the MP4 (writes the moov atom) directly on the
      // USB drive, then onRecordingFinished registers it. Reset the button now.
      try {
        await recorderRef.current?.stopRecording();
      } catch {
        // ignore
      }
      setRecording(false);
      return;
    }

    const drive = driveRef.current;
    if (!drive) return;
    const direct = canRecordDirect(drive);
    let target: DriveTarget | null = null;
    try {
      if (direct) {
        // Create the file on the USB drive first, then let CameraX write into it.
        target = createDriveFile(drive, `REC_${Date.now()}.mp4`, "video/mp4");
        targetRef.current = target;
      }
      // Dev / simulated drive: record to a temp file and copy it afterwards.
      const recorder = await videoOutput.createRecorder(target ? { filePath: target.uri } : {});
      recorderRef.current = recorder;

      await recorder.startRecording(
        (filePath: string) => {
          setRecording(false);
          recorderRef.current = null;
          if (target) {
            const finished = target;
            targetRef.current = null;
            registerDriveFile(finished, "video/mp4", drive)
              .then(() => {
                toast.show(`Saved ${finished.name} to USB`, "success");
                qc.invalidateQueries({ queryKey: ["files"] });
                qc.invalidateQueries({ queryKey: ["drive-usage"] });
              })
              .catch(() => toast.show("Recorded, but could not index the file", "error"));
          } else {
            streamToDrive(filePath, `REC_${Date.now()}.mp4`, "video/mp4");
          }
        },
        () => {
          setRecording(false);
          recorderRef.current = null;
          if (target) deleteDriveFile(target.uri);
          targetRef.current = null;
          toast.show("Recording failed", "error");
        },
      );
      setRecording(true);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      recorderRef.current = null;
      if (target) deleteDriveFile(target.uri);
      targetRef.current = null;
      toast.show("Could not start recording", "error");
    }
  }, [recording, videoOutput, streamToDrive, toast, qc]);

  const takePhoto = useCallback(async () => {
    if (recording) return;
    if (!driveRef.current) {
      toast.show("Connect a USB drive first", "error");
      return;
    }
    try {
      // Photos are small: capture to a temp file, then copy to the drive.
      const photo = await photoOutput.capturePhotoToFile({ flashMode: torch ? "on" : "off" }, {});
      if (photo?.filePath) {
        if (Platform.OS !== "web") Haptics.selectionAsync();
        await streamToDrive(photo.filePath, `IMG_${Date.now()}.jpg`, "image/jpeg");
      }
    } catch {
      toast.show("Could not capture photo", "error");
    }
  }, [recording, torch, photoOutput, streamToDrive, toast]);

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
    style: StyleSheet.absoluteFill,
    device,
    isActive: isFocused,
    outputs: [photoOutput, videoOutput],
    constraints: [{ fps }],
    torchMode: torch && device.hasTorch ? "on" : "off",
    zoom,
  };

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
