import { useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FactoryButton } from "./FactoryButton";
import { theme, spacing, typography } from "@/lib/theme";

const PRESETS = [
  "Produto em falta na gôndola",
  "Código de barras ilegível",
  "Quantidade divergente",
  "Gôndola bloqueada",
];

interface ProblemReportModalProps {
  visible: boolean;
  loading?: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}

export function ProblemReportModal({
  visible,
  loading,
  onSubmit,
  onClose,
}: ProblemReportModalProps) {
  const [reason, setReason] = useState("");

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Relatar problema</Text>
          <Text style={styles.subtitle}>
            O tempo será pausado e a equipe na Web será notificada.
          </Text>

          <View style={styles.presets}>
            {PRESETS.map((p) => (
              <FactoryButton
                key={p}
                label={p}
                variant="secondary"
                onPress={() => setReason(p)}
                style={styles.presetBtn}
              />
            ))}
          </View>

          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Descreva o problema..."
            placeholderTextColor={theme.textMuted}
            multiline
          />

          <FactoryButton
            label="Enviar e pausar"
            variant="danger"
            loading={loading}
            disabled={!reason.trim()}
            onPress={() => onSubmit(reason.trim())}
          />
          <FactoryButton label="Cancelar" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: "90%",
  },
  title: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.danger,
  },
  subtitle: { fontSize: typography.body, color: theme.textMuted },
  presets: { gap: spacing.sm },
  presetBtn: { minHeight: 52 },
  input: {
    minHeight: 80,
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    color: theme.text,
    fontSize: typography.body,
    backgroundColor: theme.bg,
  },
});
