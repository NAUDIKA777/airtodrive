import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/icon";
import { useRecordState } from "@/src/camera/recordStore";
import { mono } from "@/src/fonts";
import { useTheme } from "@/src/theme";

// A glowing record control that floats above every screen so recording /
// USB-streaming stays reachable and visible as the user moves around the app.
// Hidden on the full-screen camera route itself (which has its own big button).
export function RecordOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { recording, streaming } = useRecordState();

  const pulse = useRef(new Animated.Value(0)).current;
  const active = recording || streaming;

  useEffect(() => {
    if (active) {
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
  }, [active, pulse]);

  if (Platform.OS === "web") return null;
  if (pathname === "/camera") return null; // recorder screen owns the control there

  const color = recording ? colors.error : streaming ? colors.warning : colors.brandSecondary;
  const label = recording ? "REC" : streaming ? "USB" : "REC";
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 84 }]}>
      <View style={styles.btnWrap}>
        <Animated.View
          pointerEvents="none"
          style={[styles.halo, { backgroundColor: color, transform: [{ scale: haloScale }], opacity: active ? haloOpacity : 0.35 }]}
        />
        <Pressable
          testID="record-overlay"
          onPress={() => router.push("/camera")}
          style={[styles.btn, { borderColor: color, shadowColor: color }]}
        >
          {streaming && !recording ? (
            <Icon name="usb-flash-drive" size={22} color={color} />
          ) : (
            <View style={[styles.dot, { backgroundColor: color }]} />
          )}
          <Text style={[styles.label, { color }]}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 16, alignItems: "center", justifyContent: "center", zIndex: 50 },
  btnWrap: { width: 60, height: 60, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: 60, height: 60, borderRadius: 30 },
  btn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,6,7,0.9)",
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 12,
    elevation: 12,
    gap: 1,
  },
  dot: { width: 16, height: 16, borderRadius: 8 },
  label: { fontSize: 8, fontFamily: mono, fontWeight: "800", letterSpacing: 0.5 },
});
