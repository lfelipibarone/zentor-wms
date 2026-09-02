import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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

  useEffect(() => {
    if (!visible) setReason("");
  }, [visible]);

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  const handleSubmit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    onSubmit(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <Pressable style={styles.overlay} onPress={Keyboard.dismiss}>
          <Pressable style={styles.card} onPress={() => Keyboard.dismiss()}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
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
                    onPress={() => {
                      Keyboard.dismiss();
                      setReason(p);
                    }}
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
                textAlignVertical="top"
                blurOnSubmit
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />

              <FactoryButton
                label="Enviar e pausar"
                variant="danger"
                loading={loading}
                disabled={!reason.trim()}
                onPress={handleSubmit}
              />
              <FactoryButton
                label="Cancelar"
                variant="secondary"
                onPress={handleClose}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
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
    maxHeight: 140,
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    color: theme.text,
    fontSize: typography.body,
    backgroundColor: theme.bg,
  },
});
