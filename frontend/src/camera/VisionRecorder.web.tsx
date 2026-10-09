import { Text, View } from "react-native";

import { makeStyles, spacing } from "@/src/theme";

// VisionCamera is native-only. On web we render a short explainer so the route
// doesn't pull the native module into the web (landing-page) bundle.
export function VisionRecorder() {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Camera recorder is native-only</Text>
      <Text style={styles.body}>
        The Record-to-Drive camera uses react-native-vision-camera, which runs only on a real
        Android/iOS build — not in the web preview.
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
}));
