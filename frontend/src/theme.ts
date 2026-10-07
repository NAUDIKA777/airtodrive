// Design tokens for USB DirectFlow — "Dark-First Utility" personality.
// Single dark palette (the app is always dark, a tactical command-center look).
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  // Surfaces
  surface: "#0E0E0F",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1C1C1E",
  onSurfaceSecondary: "#EBEBF5",
  surfaceTertiary: "#2C2C2E",
  onSurfaceTertiary: "#D1D1D6",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#000000",
  muted: "#8E8E93",

  // Brand — cyan terminal accent + emerald secondary
  brand: "#00E5FF",
  onBrand: "#000000",
  brandPrimary: "#00E5FF",
  onBrandPrimary: "#000000",
  brandSecondary: "#10B981",
  onBrandSecondary: "#000000",
  brandTertiary: "rgba(0, 229, 255, 0.12)",
  onBrandTertiary: "#00E5FF",

  // Status
  success: "#10B981",
  onSuccess: "#000000",
  warning: "#F59E0B",
  onWarning: "#000000",
  error: "#FF453A",
  onError: "#FFFFFF",
  info: "#0A84FF",
  onInfo: "#FFFFFF",

  // Lines
  border: "#2C2C2E",
  borderStrong: "#3A3A3C",
  divider: "#2C2C2E",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

// Ship a single dark palette under both keys so the app is always dark
// regardless of the device setting.
export const themes: { light: ThemeColors; dark: ThemeColors } = { light: dark, dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

// Pin native chrome to dark.
setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.dark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Spacing + radius tokens from design_guidelines.json.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;
