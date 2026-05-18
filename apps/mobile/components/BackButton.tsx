import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

interface BackButtonProps {
  onPress?: () => void;
  color?: string;
}

/** Seta de voltar padrão do app (mesma em todas as telas) */
export function BackButton({
  onPress,
  color = theme.headerTint,
}: BackButtonProps) {
  const router = useRouter();

  return (
    <Pressable
      onPress={onPress ?? (() => router.back())}
      style={styles.hit}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Voltar"
    >
      <Ionicons name="chevron-back" size={26} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    marginLeft: 4,
    paddingVertical: 4,
    paddingRight: 8,
  },
});
