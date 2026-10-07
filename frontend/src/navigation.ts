import { Platform } from "react-native";

// iOS 26+ gets Liquid Glass NativeTabs; everything else (Android target, web,
// older iOS) uses the classic JS tab bar.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
