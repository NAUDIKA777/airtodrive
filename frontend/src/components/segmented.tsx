import * as Haptics from "expo-haptics";
import { Platform, Pressable, Text, View } from "react-native";

import { makeStyles, radius, spacing } from "@/src/theme";
import { mono } from "@/src/fonts";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  testID?: string;
}

export function SegmentedControl<T extends string>({ value, options, onChange, testID }: Props<T>) {
  const styles = useStyles();
  return (
    <View style={styles.container} testID={testID}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            testID={`${testID ?? "segment"}-${opt.value}`}
            onPress={() => {
              if (!active) {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                onChange(opt.value);
              }
            }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    minHeight: 44,
  },
  segmentActive: {
    backgroundColor: colors.brandPrimary,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  labelActive: {
    color: colors.onBrandPrimary,
    fontWeight: "700",
  },
}));
