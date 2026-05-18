import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { FactoryButton } from "@/components/FactoryButton";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBaseUrl } from "@/lib/api-config";
import { theme, spacing, typography } from "@/lib/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("picker@wms.local");
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
      <View style={styles.card}>
        <Text style={styles.brand}>Help Route</Text>
        <Text style={styles.subtitle}>WMS · Operações de galpão</Text>

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="username"
          style={styles.input}
          placeholderTextColor={theme.textMuted}
        />

        <Text style={styles.label}>Senha</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          style={styles.input}
          placeholderTextColor={theme.textMuted}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FactoryButton
          label={loading ? "Entrando…" : "Entrar"}
          onPress={onSubmit}
          loading={loading}
        />

        <Text style={styles.hint}>
          Separador: picker@wms.local / dev{"\n"}
          Admin também pode acessar o mobile.{"\n"}
          API: {getApiBaseUrl()}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: theme.primary,
    gap: spacing.sm,
  },
  brand: {
    fontSize: 32,
    fontWeight: "900",
    color: theme.primary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: typography.body,
    color: theme.textMuted,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: "700",
    color: theme.textMuted,
    marginTop: spacing.xs,
  },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
    color: theme.text,
  },
  error: {
    color: theme.danger,
    fontSize: typography.body,
    fontWeight: "600",
    textAlign: "center",
  },
  hint: {
    marginTop: spacing.md,
    fontSize: typography.caption,
    color: theme.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
});
