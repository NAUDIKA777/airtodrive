import Slider from "@react-native-community/slider";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/src/components/icon";
import { mono } from "@/src/fonts";
import { drive } from "@/src/services/drive";
import { formatBytes, formatDuration, type DriveFile } from "@/src/services/media";
import { readTextPreview } from "@/src/services/transfer";
import { makeStyles, radius, spacing } from "@/src/theme";
import { useTheme } from "@/src/theme";

export default function PreviewScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: file, isLoading } = useQuery({
    queryKey: ["file", id],
    queryFn: () => drive.getFile(String(id)),
  });

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="preview-back" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Icon name="chevron-left" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {file?.displayName ?? "Preview"}
          </Text>
          {file ? (
            <Text style={styles.topMeta}>
              {file.kind.toUpperCase()} · {formatBytes(file.size)}
              {file.compressed ? ` · gzip (was ${formatBytes(file.originalSize)})` : ""}
            </Text>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center} testID="preview-loading">
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : !file ? (
        <View style={styles.center} testID="preview-missing">
          <Icon name="file-alert-outline" size={40} color={colors.muted} />
          <Text style={styles.missing}>File not found</Text>
        </View>
      ) : file.kind === "video" ? (
        <VideoPreview file={file} />
      ) : file.kind === "audio" ? (
        <AudioPreview file={file} />
      ) : file.kind === "image" ? (
        <ImagePreview file={file} />
      ) : (
        <DocPreview file={file} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
function Scrubber({
  current,
  duration,
  playing,
  onToggle,
  onSeekStart,
  onSeek,
}: {
  current: number;
  duration: number;
  playing: boolean;
  onToggle: () => void;
  onSeekStart: () => void;
  onSeek: (v: number) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.controls} testID="scrubber">
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatDuration(current)}</Text>
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </View>
      <Slider
        testID="timeline-slider"
        style={styles.slider}
        minimumValue={0}
        maximumValue={duration > 0 ? duration : 1}
        value={Math.min(current, duration > 0 ? duration : 1)}
        onSlidingStart={onSeekStart}
        onSlidingComplete={onSeek}
        minimumTrackTintColor={colors.brandPrimary}
        maximumTrackTintColor={colors.surfaceTertiary}
        thumbTintColor={colors.brandPrimary}
      />
      <View style={styles.playRow}>
        <Pressable testID="play-toggle" onPress={onToggle} style={styles.playBtn}>
          <Icon name={playing ? "pause" : "play"} size={30} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
      <Text style={styles.scrubNote}>Scrubbed straight off the USB drive — the MP4 is never copied to the phone.</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
function VideoPreview({ file }: { file: DriveFile }) {
  const styles = useStyles();
  // Stream straight from the mounted USB path (content:// / file://). useCaching
  // stays false so expo-video/ExoPlayer reads the drive directly and never copies
  // the MP4 into the phone's local storage first.
  const player = useVideoPlayer({ uri: file.uri, useCaching: false }, (p) => {
    p.loop = false;
  });
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const seeking = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      try {
        if (!seeking.current) setCurrent(player.currentTime || 0);
        setDuration(player.duration || 0);
        setPlaying(player.playing);
      } catch {
        // player not ready
      }
    }, 250);
    return () => clearInterval(t);
  }, [player]);

  return (
    <View style={styles.flex}>
      <View style={styles.viewport}>
        <VideoView
          testID="video-view"
          player={player}
          style={styles.media}
          contentFit="contain"
          nativeControls={false}
        />
      </View>
      <Scrubber
        current={current}
        duration={duration}
        playing={playing}
        onToggle={() => (player.playing ? player.pause() : player.play())}
        onSeekStart={() => {
          seeking.current = true;
        }}
        onSeek={(v) => {
          player.currentTime = v;
          setCurrent(v);
          seeking.current = false;
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
function AudioPreview({ file }: { file: DriveFile }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const player = useAudioPlayer(file.uri);
  const status = useAudioPlayerStatus(player);
  const [seekVal, setSeekVal] = useState<number | null>(null);

  const duration = status?.duration ?? 0;
  const current = seekVal ?? status?.currentTime ?? 0;

  return (
    <View style={styles.flex}>
      <View style={styles.viewport}>
        <View style={styles.audioArt}>
          <Icon name="waveform" size={72} color={colors.brandPrimary} />
          <Text style={styles.audioName} numberOfLines={1}>
            {file.displayName}
          </Text>
        </View>
      </View>
      <Scrubber
        current={current}
        duration={duration}
        playing={status?.playing ?? false}
        onToggle={() => (status?.playing ? player.pause() : player.play())}
        onSeekStart={() => setSeekVal(status?.currentTime ?? 0)}
        onSeek={(v) => {
          player.seekTo(v);
          setSeekVal(null);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
function ImagePreview({ file }: { file: DriveFile }) {
  const styles = useStyles();
  return (
    <View style={styles.flex}>
      <View style={styles.viewport}>
        <Image testID="image-view" source={{ uri: file.uri }} style={styles.media} contentFit="contain" transition={200} />
      </View>
      <View style={styles.controls}>
        <Text style={styles.scrubNote}>Still image — no timeline. Streamed from the drive on demand.</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
function DocPreview({ file }: { file: DriveFile }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { data: text, isLoading } = useQuery({
    queryKey: ["doc-preview", file.id],
    queryFn: () => readTextPreview(file),
  });

  return (
    <View style={styles.flex}>
      <View style={styles.docBanner}>
        <Icon name="zip-box-outline" size={18} color={file.compressed ? colors.warning : colors.muted} />
        <Text style={styles.docBannerText}>
          {file.compressed
            ? `Decompressed on-the-fly · gzip ${formatBytes(file.size)} → ${formatBytes(file.originalSize)}`
            : "Plain file · read directly from drive"}
        </Text>
      </View>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView style={styles.docScroll} contentContainerStyle={styles.docContent}>
          <Text testID="doc-text" style={styles.docText} selectable>
            {text || "(empty)"}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  topTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  topMeta: { color: colors.muted, fontSize: 11, fontFamily: mono, marginTop: 2 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  missing: { color: colors.muted, fontSize: 14 },

  viewport: { flex: 1, backgroundColor: "#060607", alignItems: "center", justifyContent: "center" },
  media: { width: "100%", height: "100%" },
  audioArt: { alignItems: "center", gap: spacing.md, padding: spacing.xl },
  audioName: { color: colors.onSurfaceSecondary, fontSize: 14, fontFamily: mono },

  controls: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: colors.onSurfaceSecondary, fontSize: 12, fontFamily: mono },
  slider: { width: "100%", height: 40 },
  playRow: { alignItems: "center", marginTop: spacing.xs },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  scrubNote: { color: colors.muted, fontSize: 11, fontFamily: mono, textAlign: "center", marginTop: spacing.xs },

  docBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  docBannerText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 11, fontFamily: mono },
  docScroll: { flex: 1 },
  docContent: { padding: spacing.lg },
  docText: { color: colors.brandSecondary, fontSize: 12, fontFamily: mono, lineHeight: 18 },
}));
