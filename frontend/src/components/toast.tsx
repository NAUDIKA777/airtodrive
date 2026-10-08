import { createContext, useCallback, useContext, useRef, useState, type PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/src/components/icon";
import { useTheme, makeStyles, spacing, radius } from "@/src/theme";
import { mono } from "@/src/fonts";

type ToastType = "success" | "error" | "info";
interface ToastState {
  message: string;
  type: ToastType;
}

const ToastContext = createContext<{ show: (message: string, type?: ToastType) => void }>({
  show: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastType, IconName> = {
  success: "check-circle",
  error: "alert-circle",
  info: "information",
};

export function ToastProvider({ children }: PropsWithChildren) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallbackSafe((message: string, type: ToastType = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 3200);
  });

  const accent =
    toast?.type === "error" ? colors.error : toast?.type === "success" ? colors.success : colors.brandPrimary;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          entering={FadeInUp.springify().damping(18)}
          exiting={FadeOutUp.duration(180)}
          style={[styles.wrap, { top: insets.top + spacing.sm, pointerEvents: "box-none" }]}
        >
          <Pressable
            testID="toast"
            onPress={() => setToast(null)}
            style={[styles.toast, { borderColor: accent }]}
          >
            <Icon name={ICONS[toast.type]} size={18} color={accent} />
            <Text style={styles.text} numberOfLines={3}>
              {toast.message}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

// tiny local useCallback to avoid an unused import name clash
function useCallbackSafe<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef(((...args: any[]) => ref.current(...args)) as T).current;
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    maxWidth: 520,
    width: "100%",
  },
  text: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 13,
    fontFamily: mono,
  },
}));
