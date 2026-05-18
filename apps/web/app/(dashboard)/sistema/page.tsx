"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { useAuth } from "@/components/auth/auth-provider";
import { Permission } from "@wms/shared";
import { apiFetch } from "@/lib/api/client";

export default function SistemaPage() {
  const { can } = useAuth();
  const [settings, setSettings] = useState<
    Array<{ key: string; value: string; description: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ settings: typeof settings }>("/api/settings/public")
      .then((d) => setSettings(d.settings))
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sistema"
        description="Visão geral e atalhos de administração do Help Route."
      />

      <DataState loading={loading} error={error} empty={settings.length === 0}>
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Configurações atuais</h2>
          <dl className="mt-4 space-y-3">
            {settings.map((s) => (
              <div key={s.key} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                <dt className="text-sm text-muted-foreground">
                  {s.description ?? s.key}
                </dt>
                <dd className="font-medium">{s.value}</dd>
              </div>
            ))}
          </dl>
          {can(Permission.SETTINGS_MANAGE) ? (
            <Link
              href="/admin/configuracoes"
              className="mt-4 inline-block text-sm font-semibold text-[#0d9488] hover:underline"
            >
              Editar configurações →
            </Link>
          ) : null}
        </div>
      </DataState>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {can(Permission.USERS_MANAGE) ? (
          <Card
            href="/admin/usuarios"
            title="Usuários e permissões"
            text="Gerenciar acessos ao painel e ao mobile."
          />
        ) : null}
        {can(Permission.SETTINGS_MANAGE) ? (
          <Card
            href="/admin/configuracoes"
            title="Configurações"
            text="Nome da empresa e dados do CD."
          />
        ) : null}
        <Card
          href="/perfil"
          title="Meu perfil"
          text="Alterar seus dados e senha."
        />
      </div>
    </div>
  );
}

function Card({
  href,
  title,
  text,
}: {
  href: string;
  title: string;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border bg-white p-6 shadow-sm transition hover:border-[#0d9488]"
    >
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </Link>
  );
}
