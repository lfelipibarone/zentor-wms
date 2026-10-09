import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { subscribeToast } from "@/lib/app-alert";
import { theme, spacing, typography, radius } from "@/lib/theme";

const VISIBLE_MS = 2800;

export function Toaster() {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () => {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        () => setMessage(null),
      );
    };
    const unsubscribe = subscribeToast((text) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(text);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, VISIBLE_MS);
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opacity]);

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + spacing.lg, opacity }]}
    >
      <Pressable style={styles.toast} onPress={() => setMessage(null)}>
        <Ionicons name="checkmark-circle" size={22} color={theme.success} />
        <Text style={styles.text}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.md, right: spacing.md, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: theme.headerBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.lg,
    maxWidth: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: "#fff", fontWeight: "800", fontSize: typography.caption + 1, flexShrink: 1 },
});
