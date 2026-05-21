import { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function ReturnReceiptStartScreen() {
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.startReturnReceipt(reference.trim() || undefined);
      router.replace(`/purchase-receipt/return/${data.session.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erro ao iniciar devolução");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell scroll title="Devolução" subtitle="Receber produtos devolvidos">
      <Text style={styles.hint}>
        Bipe cada produto devolvido. Ao finalizar, bipe o endereço de pulmão de
        destino.
      </Text>
      <Text style={styles.label}>Referência (opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Pedido, cliente..."
        value={reference}
        onChangeText={setReference}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FactoryButton
        label="Iniciar devolução"
        onPress={start}
        loading={loading}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: theme.textMuted,
    fontSize: typography.body,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  label: { fontSize: typography.caption, color: theme.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: typography.body,
  },
  error: { color: theme.danger, marginBottom: spacing.sm },
});
