import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/src/components/icon";
import { ScreenHeader } from "@/src/components/screen-header";
import { mono } from "@/src/fonts";
import { makeStyles, radius, spacing } from "@/src/theme";
import { useTheme } from "@/src/theme";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "usb-flash-drive-outline",
    title: "Direct-to-USB streaming",
    body: "Data is written straight to the connected USB drive via Android's Storage Access Framework — never fully cached on internal storage.",
  },
  {
    icon: "zip-box-outline",
    title: "On-the-fly compression",
    body: "Text, documents and data files are gzipped as they stream. Video, audio and images pass through uncompressed for instant playback.",
  },
  {
    icon: "timeline-clock-outline",
    title: "Scrub & preview",
    body: "The media player reads the drive and seeks to any timestamp, buffering only a small temporary chunk — no full extraction to the phone.",
  },
];

export default function AboutScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <ScreenHeader title="About" subtitle="How the pipeline works" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {FEATURES.map((f) => (
          <View key={f.title} style={styles.card} testID={`about-${f.title}`}>
            <View style={styles.iconWrap}>
              <Icon name={f.icon} size={22} color={colors.brandPrimary} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{f.title}</Text>
              <Text style={styles.cardText}>{f.body}</Text>
            </View>
          </View>
        ))}

        <View style={styles.note} testID="about-build-note">
          <Icon name="alert-decagram-outline" size={18} color={colors.warning} />
          <Text style={styles.noteText}>
            USB drive access and native direct-streaming only work in a real Android build (via
            Publish). In Expo Go / web preview the app runs against a simulated drive so you can
            explore the full flow.
          </Text>
        </View>

        <Text style={styles.version}>v1.0.0 · SAF pipeline · gzip</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  cardText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  note: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: "rgba(245,158,11,0.10)",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    padding: spacing.md,
  },
  noteText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18 },
  version: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: mono,
    textAlign: "center",
    marginTop: spacing.sm,
  },
}));
