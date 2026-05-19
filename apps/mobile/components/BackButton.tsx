import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

interface BackButtonProps {
  onPress?: () => void;
  color?: string;
  /** Se true (padrão), volta à tela inicial do app em vez do histórico */
  toHome?: boolean;
}

/** Seta de voltar padrão — sem texto, mesma em todas as telas */
export function BackButton({
  onPress,
  color = theme.headerTint,
  toHome = true,
}: BackButtonProps) {
  const router = useRouter();

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    if (toHome) {
      router.replace("/");
      return;
    }
    router.back();
  };

  return (
    <Pressable
      onPress={handlePress}
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
