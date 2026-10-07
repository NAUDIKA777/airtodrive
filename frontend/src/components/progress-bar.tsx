import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { makeStyles, radius } from "@/src/theme";
import { useTheme } from "@/src/theme";

interface Props {
  // 0..1
  progress: number;
  color?: string;
  height?: number;
  testID?: string;
}

export function ProgressBar({ progress, color, height = 6, testID }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const w = useSharedValue(0);

  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 180 });
  }, [progress, w]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${w.value * 100}%`,
  }));

  return (
    <View style={[styles.track, { height }]} testID={testID}>
      <Animated.View
        style={[styles.fill, { backgroundColor: color ?? colors.brandPrimary }, barStyle]}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  track: {
    width: "100%",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
  },
}));
