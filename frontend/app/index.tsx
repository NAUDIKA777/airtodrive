import { Redirect } from "expo-router";
import { Platform } from "react-native";

import { LandingPage } from "@/src/landing/LandingPage";

export default function Index() {
  // The custom domain (web) shows the marketing / PWA landing page.
  // On native (the actual app) we go straight into the USB tool.
  if (Platform.OS === "web") {
    return <LandingPage />;
  }
  return <Redirect href="/(tabs)" />;
}
