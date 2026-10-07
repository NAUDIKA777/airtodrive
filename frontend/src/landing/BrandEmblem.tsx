import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";

import { Icon } from "@/src/components/icon";
import { useTheme } from "@/src/theme";

interface Props {
  size?: number;
}

// Orbital-scale emblem: a satellite/network cluster funnels a glowing data
// stream down through a phone and into a USB drive — the direct-to-storage
// bypass, inside a dark cybernetic badge.
export function BrandEmblem({ size = 240 }: Props) {
  const { colors } = useTheme();
  const cyan = colors.brandPrimary;
  const blue = colors.info;

  const chip = (icon: any, color: string, dim: number) => (
    <View
      style={{
        width: dim,
        height: dim,
        borderRadius: dim / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0A1418",
        borderWidth: 1.5,
        borderColor: color,
        shadowColor: color,
        shadowOpacity: 0.9,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 0 },
        elevation: 10,
      }}
    >
      <Icon name={icon} size={dim * 0.5} color={color} />
    </View>
  );

  const streamDot = (i: number) => (
    <View
      key={i}
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        marginVertical: 3,
        backgroundColor: cyan,
        shadowColor: cyan,
        shadowOpacity: 0.9,
        shadowRadius: 8,
        elevation: 6,
      }}
    />
  );

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 32,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(0,229,255,0.35)",
        shadowColor: cyan,
        shadowOpacity: 0.5,
        shadowRadius: 40,
        shadowOffset: { width: 0, height: 0 },
        elevation: 16,
      }}
    >
      <LinearGradient
        colors={["#08171C", "#070A0C", "#05060A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ ...StyleSheetAbsolute }}
      />
      {/* central connecting line */}
      <View
        style={{
          position: "absolute",
          left: size / 2 - 1,
          top: size * 0.18,
          bottom: size * 0.16,
          width: 2,
          backgroundColor: "rgba(0,229,255,0.25)",
        }}
      />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "space-between", paddingVertical: size * 0.1 }}>
        {/* orbital network */}
        <View style={{ alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: blue, shadowColor: blue, shadowOpacity: 0.9, shadowRadius: 6 }} />
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: cyan, shadowColor: cyan, shadowOpacity: 0.9, shadowRadius: 6 }} />
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cyan, shadowColor: cyan, shadowOpacity: 0.9, shadowRadius: 6 }} />
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: blue, shadowColor: blue, shadowOpacity: 0.9, shadowRadius: 6 }} />
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: cyan, shadowColor: cyan, shadowOpacity: 0.9, shadowRadius: 6 }} />
          </View>
          {chip("satellite-variant", cyan, size * 0.2)}
        </View>

        <View style={{ alignItems: "center" }}>{[0, 1, 2].map(streamDot)}</View>

        {/* phone bypass */}
        {chip("cellphone", "#FFFFFF", size * 0.22)}

        <View style={{ alignItems: "center" }}>{[0, 1, 2].map(streamDot)}</View>

        {/* USB drive */}
        {chip("usb-flash-drive", colors.brandSecondary, size * 0.2)}
      </View>
    </View>
  );
}

const StyleSheetAbsolute = { position: "absolute" as const, left: 0, right: 0, top: 0, bottom: 0 };
