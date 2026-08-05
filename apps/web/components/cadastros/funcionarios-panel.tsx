"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  PERMISSION_CATALOG,
  Permission,
  UserRole,
  UserRoleLabel,
  defaultPermissionsForRole,
  type PermissionKey,
} from "@wms/shared";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import type { AuthUser } from "@/lib/auth";
import { createUser, fetchUsers, updateUser } from "@/lib/api/users";

const ROLES = Object.values(UserRole);

const TENANT_PERMISSION_CATALOG = PERMISSION_CATALOG.filter(
  (p) => p.key !== Permission.TENANTS_MANAGE,
);

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

function roleLabel(role: string): string {
  return UserRoleLabel[role as UserRole] ?? role;
}

export function FuncionariosPanel({
  embedded = false,
  title = "Funcionários",
  description = "Cadastre funcionários, defina cargos e permissões de acesso.",
}: {
  embedded?: boolean;
  title?: string;
  description?: string;
}) {
  const { can } = useAuth();
  const canManage = can(Permission.USERS_MANAGE);

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      setUsers([]);
      setPagination(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUsers({
        page,
        q: search.trim() || undefined,
      });
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [page, search, canManage]);

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
        const body: Parameters<typeof updateUser>[1] = {
          name: form.name,
          email: form.email,
          role: form.role,
          active: form.active,
          permissions: form.permissions,
        };
        if (form.password) body.password = form.password;
        await updateUser(form.id, body);
      } else {
        if (!form.password) {
          setError("Senha é obrigatória para novo funcionário");
          setSaving(false);
          return;
        }
        await createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          active: form.active,
          permissions: form.permissions,
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

  const grouped = TENANT_PERMISSION_CATALOG.reduce(
    (acc, p) => {
      if (!acc[p.group]) acc[p.group] = [];
      acc[p.group].push(p);
      return acc;
    },
    {} as Record<string, typeof TENANT_PERMISSION_CATALOG>,
  );

  const empty = !loading && !error && users.length === 0;

  const formWarnings: string[] = [];
  if (form) {
    if (!form.active) {
      formWarnings.push(
        "Funcionário inativo não consegue fazer login no painel nem no app mobile.",
      );
    }
    if (!form.permissions.includes(Permission.WEB_ACCESS)) {
      formWarnings.push(
        'Sem a permissão "Acesso ao painel web", o funcionário não conseguirá entrar no painel.',
      );
    }
    if (!form.permissions.includes(Permission.MOBILE_ACCESS)) {
      formWarnings.push(
        'Sem a permissão "Acesso ao app mobile", o funcionário não conseguirá entrar no app.',
      );
    }
  }

  return (
    <div className="space-y-4">
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PageHeader title={title} description={description} />
          {canManage ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Novo funcionário
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
        <form
          className="flex flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput);
          }}
        >
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Buscar por nome ou e-mail"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Buscar
          </button>
        </form>
        ) : null}
        {embedded && canManage ? (
          <button
            type="button"
            onClick={openCreate}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Novo funcionário
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Você não tem permissão para visualizar ou gerenciar funcionários. Solicite
          acesso à permissão &quot;Gerenciar usuários&quot; ao administrador.
        </p>
      ) : null}

      {canManage ? (
      <DataState
        loading={loading}
        error={error}
        empty={empty}
        emptyMessage="Nenhum funcionário encontrado."
      >
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{roleLabel(u.role)}</TableCell>
                  <TableCell>
                    {u.active === false ? "Inativo" : "Ativo"}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="font-medium text-[#0d9488] hover:underline"
                      >
                        Editar
                      </button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {pagination && pagination.total > 0 ? (
          <Pagination pagination={pagination} onPageChange={setPage} />
        ) : null}
      </DataState>
      ) : null}

      {form && canManage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">
              {form.id ? "Editar funcionário" : "Novo funcionário"}
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
                <label className="text-sm font-medium">Cargo</label>
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={form.role}
                  onChange={(e) => onRoleChange(e.target.value)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
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
                Funcionário ativo
              </label>
            </div>

            {formWarnings.length > 0 ? (
              <div className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {formWarnings.map((msg) => (
                  <p key={msg}>{msg}</p>
                ))}
              </div>
            ) : null}

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
