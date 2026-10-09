import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { ScreenShell } from "@/components/ScreenShell";
import { FactoryButton } from "@/components/FactoryButton";
import { Field, Notice } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBaseUrl } from "@/lib/api";
import { getStoredToken } from "@/lib/auth";
import { theme, typography } from "@/lib/theme";

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
    <ScreenShell scroll title={user.name} subtitle={user.email}>
      <Text style={styles.label}>Link da foto</Text>
      <Field
        value={avatarUrl}
        onChangeText={setAvatarUrl}
        placeholder="https://…"
        autoCapitalize="none"
      />
      {message ? (
        <Notice tone={message.startsWith("Erro") ? "danger" : "success"}>{message}</Notice>
      ) : null}
      <FactoryButton label="Salvar" icon="checkmark" onPress={save} loading={saving} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
