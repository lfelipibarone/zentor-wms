import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScreenShell } from "@/components/ScreenShell";
import { FactoryButton } from "@/components/FactoryButton";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBaseUrl } from "@/lib/api";
import { getStoredToken } from "@/lib/auth";
import { theme, spacing, typography } from "@/lib/theme";

export default function PerfilScreen() {
  const { user, refresh } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const token = await getStoredToken();
      const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ avatarUrl: avatarUrl.trim() || null }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      await refresh();
      setMessage("Perfil atualizado.");
    } catch {
      setMessage("Erro ao salvar perfil.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <ScreenShell subtitle={user.email} scroll>
      <View style={styles.card}>
        <Text style={styles.label}>URL da foto (opcional)</Text>
        <TextInput
          value={avatarUrl}
          onChangeText={setAvatarUrl}
          placeholder="https://…"
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.hint}>
          Informe um link público para exibir sua foto no avatar.
        </Text>
        {message ? <Text style={styles.msg}>{message}</Text> : null}
        <FactoryButton
          label={saving ? "Salvando…" : "Salvar"}
          onPress={save}
          disabled={saving}
        />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: { fontWeight: "700", color: theme.text },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: spacing.sm,
    color: theme.text,
  },
  hint: { fontSize: typography.caption, color: theme.textMuted },
  msg: { color: theme.primary, fontWeight: "600" },
});
