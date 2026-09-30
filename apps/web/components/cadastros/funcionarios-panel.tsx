"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  Permission,
  UserRole,
  UserRoleLabel,
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

type FormState = {
  id?: string;
  email: string;
  name: string;
  password: string;
  role: string;
  active: boolean;
};

const emptyForm = (): FormState => ({
  email: "",
  name: "",
  password: "",
  role: UserRole.EXPEDITER,
  active: true,
});

function roleLabel(role: string): string {
  return UserRoleLabel[role as UserRole] ?? role;
}

export function FuncionariosPanel({
  embedded = false,
  title = "Funcionários",
  description = "Cadastre funcionários e atribua um cargo. Canais e módulos são definidos em Admin → Cargos.",
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
    });

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

  const empty = !loading && !error && users.length === 0;

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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">
              {form.id ? "Editar funcionário" : "Novo funcionário"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Permissões vêm do cargo. Ajuste a matriz em{" "}
              <a href="/admin/cargos" className="font-medium text-[#0d9488] hover:underline">
                Admin → Cargos
              </a>
              .
            </p>
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
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
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

            {!form.active ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Funcionário inativo não consegue fazer login no painel nem no app
                mobile.
              </div>
            ) : null}

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
