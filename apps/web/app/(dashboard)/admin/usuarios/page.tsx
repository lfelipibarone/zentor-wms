"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  PERMISSION_CATALOG,
  UserRole,
  defaultPermissionsForRole,
  type PermissionKey,
} from "@wms/shared";
import { apiFetch } from "@/lib/api/client";
import type { AuthUser } from "@/lib/auth";

const ROLES = Object.values(UserRole);

type FormState = {
  id?: string;
  email: string;
  name: string;
  password: string;
  role: string;
  active: boolean;
  permissions: PermissionKey[];
};

const emptyForm = (): FormState => ({
  email: "",
  name: "",
  password: "",
  role: UserRole.EXPEDITER,
  active: true,
  permissions: defaultPermissionsForRole(UserRole.EXPEDITER),
});

export default function AdminUsuariosPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ users: AuthUser[] }>("/api/admin/users");
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => setForm(emptyForm());
  const openEdit = (u: AuthUser) =>
    setForm({
      id: u.id,
      email: u.email,
      name: u.name,
      password: "",
      role: u.role,
      active: u.active !== false,
      permissions: u.permissions as PermissionKey[],
    });

  const togglePermission = (key: PermissionKey) => {
    if (!form) return;
    const has = form.permissions.includes(key);
    setForm({
      ...form,
      permissions: has
        ? form.permissions.filter((p) => p !== key)
        : [...form.permissions, key],
    });
  };

  const onRoleChange = (role: string) => {
    if (!form) return;
    setForm({
      ...form,
      role,
      permissions: defaultPermissionsForRole(role as UserRole),
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        const body: Record<string, unknown> = {
          name: form.name,
          email: form.email,
          role: form.role,
          active: form.active,
          permissions: form.permissions,
        };
        if (form.password) body.password = form.password;
        await apiFetch(`/api/admin/users/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            password: form.password,
            role: form.role,
            active: form.active,
            permissions: form.permissions,
          }),
        });
      }
      setForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const grouped = PERMISSION_CATALOG.reduce(
    (acc, p) => {
      if (!acc[p.group]) acc[p.group] = [];
      acc[p.group].push(p);
      return acc;
    },
    {} as Record<string, typeof PERMISSION_CATALOG>,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Usuários e permissões
          </h1>
          <p className="text-muted-foreground">
            Crie usuários e controle o que cada um pode acessar no Help Route.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Novo usuário
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="px-4 py-3 font-medium">Papel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.role}</td>
                  <td className="px-4 py-3">
                    {u.active === false ? "Inativo" : "Ativo"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="font-medium text-[#0d9488] hover:underline"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">
              {form.id ? "Editar usuário" : "Novo usuário"}
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Nome</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">E-mail</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  {form.id ? "Nova senha (opcional)" : "Senha"}
                </label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">Papel</label>
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={form.role}
                  onChange={(e) => onRoleChange(e.target.value)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                Usuário ativo
              </label>
            </div>

            <p className="mt-6 text-sm font-medium">Permissões</p>
            <div className="mt-2 space-y-4">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {group}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {items.map((p) => (
                      <label
                        key={p.key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(p.key)}
                          onChange={() => togglePermission(p.key)}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
