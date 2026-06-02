import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme, typography } from "@/lib/theme";

interface ProductThumbnailProps {
  imageUrl?: string | null;
  alt?: string;
  size?: number;
}

export function ProductThumbnail({
  imageUrl,
  alt = "Produto",
  size = 80,
}: ProductThumbnailProps) {
  const borderRadius = 10;

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        accessibilityLabel={alt}
        style={[
          styles.image,
          { width: size, height: size, borderRadius },
        ]}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius },
      ]}
      accessibilityLabel={`${alt} sem imagem`}
    >
      <Ionicons name="cube-outline" size={size * 0.4} color={theme.textMuted} />
      <Text style={styles.placeholderText}>Sem foto</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.border,
  },
  placeholder: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  placeholderText: {
    fontSize: typography.caption - 2,
    color: theme.textMuted,
    fontWeight: "600",
  },
});
