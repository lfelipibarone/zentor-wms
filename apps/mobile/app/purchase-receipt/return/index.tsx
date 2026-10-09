import { useState } from "react";
import { router } from "expo-router";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { Field, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { modules } from "@/lib/modules";

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
    <ScreenShell scroll module="recebimento" title="Devolução">
      <Field
        placeholder="Referência (opcional): pedido, cliente…"
        value={reference}
        onChangeText={setReference}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FactoryButton
        label="Iniciar devolução"
        icon="return-down-back"
        color={modules.recebimento.color}
        onPress={start}
        loading={loading}
      />
    </ScreenShell>
  );
}
