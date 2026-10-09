import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenShell } from "@/components/ScreenShell";
import type { IconName } from "@/lib/modules";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius, shadow } from "@/lib/theme";

const color = modules.recebimento.color;

export default function PurchaseReceiptHomeScreen() {
  return (
    <ScreenShell module="recebimento" title="Recebimento">
      <BigOption icon="document-text" label="NF de entrada" href="/purchase-receipt/entry" />
      <BigOption icon="return-down-back" label="Devolução" href="/purchase-receipt/return" />
    </ScreenShell>
  );
}

function BigOption({ icon, label, href }: { icon: IconName; label: string; href: Href }) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <Ionicons name={icon} size={32} color="#fff" />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={26} color={theme.textSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: theme.border,
    ...shadow,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  icon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: color,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, fontSize: typography.subtitle, fontWeight: "900", color: theme.text },
});
