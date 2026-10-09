import { useCallback, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { FactoryButton } from "./FactoryButton";
import { theme, spacing, typography, radius } from "@/lib/theme";

interface BarcodeScannerProps {
  visible: boolean;
  title: string;
  hint?: string;
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({
  visible,
  title,
  hint,
  onScan,
  onClose,
}: BarcodeScannerProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;
      scannedRef.current = true;
      setLastCode(data);
      onScan(data);
    },
    [onScan]
  );

  const resetScan = () => {
    scannedRef.current = false;
    setLastCode(null);
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={[styles.permissionBox, { paddingTop: insets.top + spacing.xl }]}>
            <Ionicons
              name="camera-outline"
              size={64}
              color={theme.headerMuted}
              style={styles.centerSelf}
            />
            <Text style={styles.permissionText}>Libere a câmera para bipar</Text>
            <FactoryButton label="Permitir câmera" icon="camera" onPress={requestPermission} />
            <FactoryButton label="Fechar" variant="secondary" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  "ean13",
                  "ean8",
                  "code128",
                  "code39",
                  "qr",
                  "upc_a",
                  "upc_e",
                ],
              }}
              onBarcodeScanned={scannedRef.current ? undefined : handleBarcode}
            />
            <View style={styles.reticleWrap} pointerEvents="none">
              <View style={styles.reticle} />
            </View>

            <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
              <View style={styles.flex}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                {hint ? (
                  <Text style={styles.hint} numberOfLines={2}>
                    {hint}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={12}
                accessibilityLabel="Fechar leitor"
              >
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
            </View>

            {lastCode ? (
              <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
                <View style={styles.lastCode}>
                  <Ionicons name="checkmark-circle" size={20} color={theme.success} />
                  <Text style={styles.lastCodeText} numberOfLines={1}>
                    {lastCode}
                  </Text>
                </View>
                <FactoryButton
                  label="Bipar novamente"
                  icon="scan"
                  size="md"
                  variant="secondary"
                  onPress={resetScan}
                />
              </View>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

/** Botão que abre o scanner em modal */
export function ScanTriggerButton({
  label,
  onScan,
}: {
  label: string;
  onScan: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FactoryButton label={label} icon="scan" onPress={() => setOpen(true)} />
      <BarcodeScanner
        visible={open}
        title="Escanear código"
        onScan={(code) => {
          setOpen(false);
          onScan(code);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  centerSelf: { alignSelf: "center" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: "rgba(15,23,42,0.75)",
  },
  title: { fontSize: typography.subtitle, fontWeight: "900", color: "#fff" },
  hint: { fontSize: typography.caption, color: theme.headerMuted, fontWeight: "600", marginTop: 2 },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  reticleWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: "78%",
    aspectRatio: 1.4,
    borderWidth: 4,
    borderColor: theme.primary,
    borderRadius: radius.xl,
  },
  permissionBox: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: "stretch",
  },
  permissionText: {
    color: "#fff",
    fontSize: typography.subtitle,
    fontWeight: "800",
    textAlign: "center",
  },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: "rgba(15,23,42,0.75)",
  },
  lastCode: { flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center" },
  lastCodeText: { color: "#fff", fontSize: typography.body, fontWeight: "800" },
});
