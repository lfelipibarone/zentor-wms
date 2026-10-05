"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ops/page-header";
import {
  applyInventoryLayout,
  previewInventoryLayout,
  type InventoryLayoutPreview,
  type InventoryLayoutResult,
  type InventoryLayoutRow,
} from "@/lib/api/warehouse";
import { parseInventoryXlsx } from "@/lib/inventory-layout-import";

type EstanteDraft = {
  barracao: string;
  estante: string;
  include: boolean;
  ldColunas: number;
  leColunas: number;
  linhas: number;
  /** Maior coluna e linha vistas na planilha — abaixo disso endereços ficam sem posição. */
  minColunas: number;
  minLinhas: number;
  addressCount: number;
};

const LIST_LIMIT = 30;

function toInt(value: string, min: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(200, n)) : min;
}

function NumberCell({ value, min, onChange }: { value: number; min: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(toInt(e.target.value, min))}
      className="w-16 rounded border px-2 py-1 text-right text-sm"
    />
  );
}

export default function GestaoBarracaoInventarioPage() {
  const [fileName, setFileName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [rows, setRows] = useState<InventoryLayoutRow[]>([]);
  const [preview, setPreview] = useState<InventoryLayoutPreview | null>(null);
  const [drafts, setDrafts] = useState<EstanteDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<InventoryLayoutResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setResult(null);
    setPreview(null);
    setLoading(true);
    try {
      const parsed = await parseInventoryXlsx(file);
      const plan = await previewInventoryLayout(parsed.rows);
      setFileName(file.name);
      setSheetName(parsed.sheetName);
      setRows(parsed.rows);
      setPreview(plan);
      setDrafts(
        plan.estantes.map((e) => {
          const colunas = e.ld.colunas + (e.le?.colunas ?? 0);
          return {
            barracao: e.barracao,
            estante: e.estante,
            include: !plan.missingBarracoes.includes(e.barracao),
            ldColunas: e.ld.colunas,
            leColunas: e.le?.colunas ?? 0,
            linhas: e.ld.linhas,
            minColunas: colunas,
            minLinhas: e.ld.linhas,
            addressCount: e.addressCount,
          };
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao ler a planilha");
    } finally {
      setLoading(false);
    }
  };

  const updateDraft = (index: number, patch: Partial<EstanteDraft>) =>
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  const selected = drafts.filter((d) => d.include);
  const totalPositions = selected.reduce((sum, d) => sum + (d.ldColunas + d.leColunas) * d.linhas, 0);
  const shrunk = selected.filter((d) => d.ldColunas + d.leColunas < d.minColunas || d.linhas < d.minLinhas);
  const assignedSkus = useMemo(() => {
    if (!preview) return 0;
    const included = new Set(selected.map((d) => `${d.barracao}-${d.estante}`));
    return preview.assignments.filter((a) => included.has(a.code.split("-").slice(0, -2).join("-"))).length;
  }, [preview, selected]);

  const apply = async () => {
    setSaving(true);
    setErr(null);
    setResult(null);
    try {
      setResult(
        await applyInventoryLayout({
          rows,
          estantes: selected.map((d) => ({
            barracao: d.barracao,
            estante: d.estante,
            ld: { colunas: d.ldColunas, linhas: d.linhas },
            le: d.leColunas > 0 ? { colunas: d.leColunas, linhas: d.linhas } : null,
          })),
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao importar layout");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Layout pela planilha de inventário"
        description="Lê a coluna Localização (ex.: B1-D-12-7, B1-O-E7-2-3), cria todas as posições de cada estante e associa o SKU de cada endereço."
      >
        <Link
          href="/gestao-barracao"
          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Voltar
        </Link>
      </PageHeader>

      <div className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          Planilha de inventário (.xlsx / .xls)
          <input
            type="file"
            accept=".xlsx,.xls"
            className="mt-2 block text-sm"
            disabled={loading || saving}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          <li>
            <span className="font-mono">B1-D-12-7</span>: barracão B1, estante D, coluna 12, linha 7.
          </li>
          <li>
            <span className="font-mono">B1-O-E7-2-3</span>: estante O-E7 (rua O, estante 7), coluna 2, linha 3.
          </li>
          <li>
            <span className="font-mono">B1-A-E2-3</span>: só a coluna (3), na linha 1.
          </li>
          <li>
            Cada estante entra inteira num lado (LD). No Mapa do galpão, junte duas estantes de costas numa gôndola (ex.:
            C no LE e D no LD).
          </li>
          <li>O pulmão depois da barra (ex.: /Z509) ainda não é importado.</li>
          <li>A etiqueta de cada posição é o próprio endereço.</li>
        </ul>
        {loading ? <p className="text-sm text-slate-500">Lendo planilha…</p> : null}
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
      </div>

      {preview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Aba lida", sheetName, fileName],
              ["Estantes", String(drafts.length), `${selected.length} selecionadas`],
              ["Posições a criar", String(totalPositions), "grade completa"],
              ["SKUs a associar", String(assignedSkus), `${preview.extraSkus.length} endereços com mais de um SKU`],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-xl border bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
                <p className="mt-1 truncate text-xl font-semibold text-slate-900">{value}</p>
                <p className="truncate text-xs text-slate-500">{hint}</p>
              </div>
            ))}
          </div>

          {preview.missingBarracoes.length ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Barracão não cadastrado: {preview.missingBarracoes.join(", ")}. Cadastre em Gestão do barracão para
              importar essas estantes.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.length === drafts.length}
                      onChange={(e) => setDrafts((ds) => ds.map((d) => ({ ...d, include: e.target.checked })))}
                    />
                  </th>
                  <th className="px-3 py-2">Estante</th>
                  <th className="px-3 py-2 text-right">Colunas LD</th>
                  <th className="px-3 py-2 text-right">Colunas LE</th>
                  <th className="px-3 py-2 text-right">Linhas</th>
                  <th className="px-3 py-2">Numeração</th>
                  <th className="px-3 py-2 text-right">Posições</th>
                  <th className="px-3 py-2 text-right">Na planilha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {drafts.map((d, i) => {
                  const colunas = d.ldColunas + d.leColunas;
                  const small = colunas < d.minColunas || d.linhas < d.minLinhas;
                  return (
                    <tr key={`${d.barracao}-${d.estante}`} className={d.include ? "" : "opacity-50"}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={d.include}
                          onChange={(e) => updateDraft(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">
                        {d.barracao}-{d.estante}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={d.ldColunas} min={1} onChange={(v) => updateDraft(i, { ldColunas: v })} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={d.leColunas} min={0} onChange={(v) => updateDraft(i, { leColunas: v })} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={d.linhas} min={1} onChange={(v) => updateDraft(i, { linhas: v })} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        LD 1–{d.ldColunas}
                        {d.leColunas > 0 ? ` · LE ${d.ldColunas + 1}–${colunas}` : ""}
                        {small ? (
                          <span className="ml-2 font-medium text-amber-700">
                            planilha vai até coluna {d.minColunas}, linha {d.minLinhas}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">{colunas * d.linhas}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{d.addressCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.invalid.length || preview.extraSkus.length || preview.pulmaoRefs ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {preview.invalid.length ? (
                <div className="rounded-xl border border-red-200 bg-white p-4 text-sm shadow-sm">
                  <p className="font-semibold text-red-700">
                    {preview.invalid.length} endereço{preview.invalid.length === 1 ? "" : "s"} não reconhecido
                    {preview.invalid.length === 1 ? "" : "s"} (ignorados)
                  </p>
                  {preview.invalid.slice(0, LIST_LIMIT).map((e) => (
                    <p key={`${e.row}-${e.address}`} className="mt-1 text-xs text-slate-700">
                      <span className="font-mono">{e.address}</span> — {e.message}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="rounded-xl border bg-white p-4 text-sm shadow-sm">
                {preview.pulmaoRefs ? (
                  <p className="text-slate-700">
                    {preview.pulmaoRefs} linha{preview.pulmaoRefs === 1 ? "" : "s"} com pulmão (/Z…): só o endereço
                    antes da barra é usado.
                  </p>
                ) : null}
                {preview.extraSkus.length ? (
                  <>
                    <p className="mt-2 font-semibold text-slate-800">
                      Endereços com mais de um SKU — fica o primeiro, estes não são associados:
                    </p>
                    {preview.extraSkus.slice(0, LIST_LIMIT).map((e) => (
                      <p key={e.code} className="mt-1 text-xs text-slate-700">
                        <span className="font-mono">{e.code}</span>: {e.skus.join(", ")}
                      </p>
                    ))}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving || !selected.length}
              onClick={apply}
              className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Criando layout…" : `Criar ${totalPositions} posições e associar SKUs`}
            </button>
            {shrunk.length ? (
              <p className="text-xs text-amber-700">
                {shrunk.length} estante{shrunk.length === 1 ? "" : "s"} menor{shrunk.length === 1 ? "" : "es"} que a
                planilha: os endereços fora da grade não terão posição.
              </p>
            ) : null}
            <p className="text-xs text-slate-500">Posições que já existem são mantidas; pode importar de novo.</p>
          </div>
        </>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          <p className="font-semibold">
            {result.estantes} estante{result.estantes === 1 ? "" : "s"} · {result.created} posições criadas
            {result.skipped ? ` · ${result.skipped} já existiam` : ""}
            {result.relabeled ? ` · ${result.relabeled} etiquetas trocadas pelo endereço` : ""}
          </p>
          <p>
            {result.skus.associated} SKUs associados
            {result.skus.unchanged ? ` · ${result.skus.unchanged} já estavam associados` : ""}
            {result.skus.notFound.length ? ` · ${result.skus.notFound.length} SKUs não cadastrados no sistema` : ""}
          </p>
          {result.skus.notFound.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">
                SKUs não encontrados (sincronize o Tiny e importe de novo)
              </summary>
              <p className="mt-1 break-words font-mono text-slate-700">{result.skus.notFound.join(", ")}</p>
            </details>
          ) : null}
          {result.errors.length ? (
            <details className="text-xs" open={result.errors.length <= 10}>
              <summary className="cursor-pointer font-medium text-red-700">{result.errors.length} com erro</summary>
              {result.errors.slice(0, 200).map((e, i) => (
                <p key={`${e.address}-${i}`} className="mt-1 text-red-700">
                  <span className="font-mono">{e.address}</span>: {e.message}
                </p>
              ))}
            </details>
          ) : null}
          <div className="flex gap-3 text-xs font-medium">
            <Link href="/gestao-barracao/mapa" className="underline">
              Posicionar estantes no mapa
            </Link>
            <Link href="/gestao-barracao" className="underline">
              Ver localizações
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
