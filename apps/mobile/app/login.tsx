import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { FactoryButton } from "@/components/FactoryButton";
import { Field, Notice } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { theme, spacing, typography, radius } from "@/lib/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao entrar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandWrap}>
          <View style={styles.logo}>
            <Ionicons name="cube" size={36} color="#fff" />
          </View>
          <Text style={styles.brand}>Help Route</Text>
        </View>

        <View style={styles.card}>
          <Field
            value={email}
            onChangeText={setEmail}
            placeholder="E-mail"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="username"
          />
          <Field
            value={password}
            onChangeText={setPassword}
            placeholder="Senha"
            secureTextEntry
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <FactoryButton
            label="Entrar"
            icon="log-in"
            onPress={onSubmit}
            loading={loading}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.headerBg },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  brandWrap: { alignItems: "center", gap: spacing.sm },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 30, fontWeight: "900", color: "#fff" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
