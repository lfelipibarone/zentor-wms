"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/components/auth/auth-provider";

export default function OlistIntegracaoPage() {
  const { refresh } = useAuth();
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ configured: boolean }>("/auth/me/olist-token")
      .then((r) => setConfigured(r.configured))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiFetch<{ configured: boolean }>("/auth/me/olist-token", {
        method: "PATCH",
        body: JSON.stringify({ token }),
      });
      setConfigured(res.configured);
      setToken("");
      setMessage(
        res.configured
          ? "Token Olist salvo com sucesso."
          : "Token Olist removido.",
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    setToken("");
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/auth/me/olist-token", {
        method: "PATCH",
        body: JSON.stringify({ token: "" }),
      });
      setConfigured(false);
      setMessage("Token removido.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Integração Olist"
        description="Configure o token de API da Olist vinculado ao seu usuário para sincronização de pedidos."
      />

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-sm font-medium">
            Token da API Olist
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              configured ? "•••••••••••• (já configurado)" : "Cole seu token aqui"
            }
            className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
            autoComplete="off"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            O token fica associado ao seu usuário e não é exibido após salvar.
            {configured ? " Você já possui um token configurado — informe um novo para substituir." : ""}
          </p>
        </div>

        {message ? (
          <p className="text-sm text-[#0d9488]">{message}</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving || !token.trim()}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar token"}
          </button>
          {configured ? (
            <button
              type="button"
              onClick={onClear}
              disabled={saving}
              className="rounded-lg border px-4 py-2 text-sm font-medium text-red-600"
            >
              Remover token
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
