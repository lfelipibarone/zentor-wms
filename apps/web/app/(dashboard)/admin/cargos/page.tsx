"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EDITABLE_TENANT_ROLES,
  ROLE_MATRIX_CATALOG,
  UserRoleLabel,
  type PermissionKey,
  type UserRole,
} from "@wms/shared";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { Permission } from "@wms/shared";
import {
  fetchRolePermissions,
  updateRolePermissions,
} from "@/lib/api/role-permissions";

export default function AdminCargosPage() {
  const { can } = useAuth();
  const canManage = can(Permission.USERS_MANAGE);

  const [draft, setDraft] = useState<Record<string, PermissionKey[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRolePermissions();
      const next: Record<string, PermissionKey[]> = {};
      for (const row of data.roles) {
        if (row.editable) next[row.role] = [...row.permissions];
      }
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar cargos");
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (role: UserRole, key: PermissionKey) => {
    setDraft((prev) => {
      const current = prev[role] ?? [];
      const has = current.includes(key);
      return {
        ...prev,
        [role]: has ? current.filter((p) => p !== key) : [...current, key],
      };
    });
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = EDITABLE_TENANT_ROLES.map((role) => ({
        role,
        permissions: draft[role] ?? [],
      }));
      const data = await updateRolePermissions(payload);
      const next: Record<string, PermissionKey[]> = {};
      for (const row of data.roles) {
        if (row.editable) next[row.role] = [...row.permissions];
      }
      setDraft(next);
      setMessage("Matriz de cargos salva. Os acessos passam a valer nas próximas requisições.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const grouped = ROLE_MATRIX_CATALOG.reduce(
    (acc, p) => {
      if (!acc[p.group]) acc[p.group] = [];
      acc[p.group].push(p);
      return acc;
    },
    {} as Record<string, typeof ROLE_MATRIX_CATALOG>,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Cargos e acessos"
          description="Defina, por cargo, o acesso ao App Mobile / Painel Web e os módulos visíveis. Funcionários herdam o cargo — não há permissão individual."
        />
        {canManage ? (
          <button
            type="button"
            disabled={saving || loading}
            onClick={save}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar matriz"}
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Você não tem permissão para gerenciar cargos.
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      {canManage ? (
        <DataState loading={loading} error={error} empty={false}>
          <div className="space-y-4">
            {EDITABLE_TENANT_ROLES.map((role) => (
              <section
                key={role}
                className="rounded-xl border bg-white p-5 shadow-sm"
              >
                <h2 className="text-base font-semibold">
                  {UserRoleLabel[role] ?? role}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Acessos e módulos deste cargo nesta empresa.
                </p>
                <div className="mt-4 space-y-4">
                  {Object.entries(grouped).map(([group, items]) => (
                    <div key={group}>
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {group}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {items.map((p) => (
                          <label
                            key={p.key}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={(draft[role] ?? []).includes(p.key)}
                              onChange={() => toggle(role, p.key)}
                            />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <section className="rounded-xl border border-dashed bg-slate-50 p-5">
              <h2 className="text-base font-semibold">
                {UserRoleLabel.ADMIN}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Acesso total à empresa (exceto gestão da plataforma). Não é
                editável na matriz.
              </p>
            </section>
          </div>
        </DataState>
      ) : null}
    </div>
  );
}
