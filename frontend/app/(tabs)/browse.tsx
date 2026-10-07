import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/icon";
import { ProgressBar } from "@/src/components/progress-bar";
import { ScreenHeader } from "@/src/components/screen-header";
import { useToast } from "@/src/components/toast";
import { mono } from "@/src/fonts";
import { useDeleteFile, useDriveFiles, useDriveStatus, useDriveUsage } from "@/src/hooks/useDrive";
import { DRIVE_CAPACITY } from "@/src/services/drive";
import { formatBytes, iconForKind, type DriveFile } from "@/src/services/media";
import { makeStyles, radius, spacing } from "@/src/theme";
import { useTheme } from "@/src/theme";

export default function BrowseScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const { data: drive } = useDriveStatus();
  const { data: files, isFetching, refetch } = useDriveFiles();
  const { data: usage } = useDriveUsage();
  const del = useDeleteFile();

  const usedPct = usage ? Math.min(1, usage.used / DRIVE_CAPACITY) : 0;

  const handleDelete = async (f: DriveFile) => {
    await del.mutateAsync(f.id);
    toast.show(`Deleted ${f.displayName}`, "info");
  };

  if (!drive) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Browse" subtitle="USB file explorer" />
        <View style={styles.empty} testID="browse-no-drive">
          <Icon name="usb-port" size={44} color={colors.muted} />
          <Text style={styles.emptyTitle}>No drive connected</Text>
          <Text style={styles.emptyBody}>Connect a USB drive from the Transfer tab to browse its files.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Browse" subtitle={drive.name} />
      <FlatList
        data={files ?? []}
        keyExtractor={(f) => f.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.brandPrimary} />
        }
        ListHeaderComponent={
          <View style={styles.statHeader}>
            <View style={styles.statRow}>
              <Text style={styles.statUsed}>{formatBytes(usage?.used ?? 0)}</Text>
              <Text style={styles.statCap}>/ {formatBytes(DRIVE_CAPACITY)}</Text>
            </View>
            <ProgressBar progress={usedPct} color={colors.brandSecondary} height={6} />
            <Text style={styles.statCount}>{files?.length ?? 0} files on drive</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty} testID="browse-empty">
            <Icon name="usb-flash-drive-outline" size={44} color={colors.muted} />
            <Text style={styles.emptyTitle}>USB drive is empty</Text>
            <Text style={styles.emptyBody}>Stream a file from the Transfer tab to see it here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`file-row-${item.id}`}
            onPress={() => router.push(`/preview/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowIcon}>
              {item.kind === "image" ? (
                <Image source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" transition={150} />
              ) : (
                <Icon name={iconForKind(item.kind)} size={22} color={colors.brandPrimary} />
              )}
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.displayName}
              </Text>
              <View style={styles.rowMetaRow}>
                <Text style={styles.rowMeta}>{formatBytes(item.size)}</Text>
                <Text style={styles.rowDot}>·</Text>
                <Text style={styles.rowMeta}>{item.kind}</Text>
                {item.compressed ? (
                  <View style={styles.gzBadge}>
                    <Text style={styles.gzBadgeText}>GZIP</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Pressable testID={`delete-${item.id}`} onPress={() => handleDelete(item)} hitSlop={10} style={styles.delBtn}>
              <Icon name="trash-can-outline" size={18} color={colors.muted} />
            </Pressable>
            <Icon name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  list: { padding: spacing.lg, gap: spacing.sm },
  statHeader: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.sm },
  statRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  statUsed: { color: colors.onSurface, fontSize: 22, fontWeight: "800", fontFamily: mono },
  statCap: { color: colors.muted, fontSize: 13, fontFamily: mono },
  statCount: { color: colors.muted, fontSize: 11, fontFamily: mono },

  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  rowPressed: { backgroundColor: colors.surfaceTertiary },
  rowIcon: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  rowBody: { flex: 1 },
  rowName: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  rowMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  rowMeta: { color: colors.muted, fontSize: 11, fontFamily: mono },
  rowDot: { color: colors.muted, fontSize: 11 },
  gzBadge: { backgroundColor: "rgba(245,158,11,0.18)", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginLeft: 2 },
  gzBadgeText: { color: colors.warning, fontSize: 9, fontFamily: mono, fontWeight: "700" },
  delBtn: { padding: 6 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl, marginTop: spacing["3xl"] },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginTop: spacing.sm },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
}));
