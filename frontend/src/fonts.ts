import { Platform } from "react-native";

// Terminal / metric font for the dense data console. Uses platform monospace
// so no font files need bundling.
export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as string;
