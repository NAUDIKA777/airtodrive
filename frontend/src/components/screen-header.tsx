import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mono } from "@/src/fonts";
import { makeStyles, spacing } from "@/src/theme";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function ScreenHeader({ title, subtitle, right }: Props) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.row}>
        <View style={styles.titleWrap}>
          <View style={styles.dotRow}>
            <View style={[styles.dot, styles.dotCyan]} />
            <Text style={styles.kicker}>USB DIRECTFLOW</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  titleWrap: { flex: 1 },
  dotRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotCyan: { backgroundColor: colors.brandPrimary },
  kicker: { color: colors.muted, fontSize: 11, fontFamily: mono, letterSpacing: 2 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
}));
