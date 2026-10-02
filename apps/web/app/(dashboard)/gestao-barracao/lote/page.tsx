"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import {
  fetchBarracoesList,
  generateEstante,
  type GenerateEstanteResult,
  type WarehouseBarracaoOption,
} from "@/lib/api/warehouse";

const MAX_POSITIONS = 2000;
const PREVIEW_LIMIT = 16;

function clampInt(value: string, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

type Side = "LD" | "LE";

function SidePreview({
  side,
  estante,
  firstColuna,
  colunas,
  linhas,
}: {
  side: Side;
  estante: string;
  firstColuna: number;
  colunas: number;
  linhas: number;
}) {
  const cols = Array.from({ length: Math.min(colunas, PREVIEW_LIMIT) }, (_, i) => firstColuna + i);
  const rows = Array.from({ length: Math.min(linhas, PREVIEW_LIMIT) }, (_, i) => linhas - i);
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-slate-700">
        {side} · colunas {firstColuna} a {firstColuna + colunas - 1} · {linhas} linha{linhas === 1 ? "" : "s"}
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-[11px]">
          <tbody>
            {rows.map((l) => (
              <tr key={l}>
                <th className="pr-1 text-right font-medium text-slate-500">Lin {l}</th>
                {cols.map((c) => (
                  <td
                    key={c}
                    className={`whitespace-nowrap rounded border px-1.5 py-1 text-center font-mono ${
                      side === "LD" ? "bg-cyan-50 text-cyan-900" : "bg-violet-50 text-violet-900"
                    }`}
                  >
                    {estante || "?"}-{side}-{c}-{l}
                  </td>
                ))}
                {colunas > PREVIEW_LIMIT ? <td className="text-slate-400">…</td> : null}
              </tr>
            ))}
            <tr>
              <th />
              {cols.map((c) => (
                <td key={c} className="text-center font-medium text-slate-500">
                  Col {c}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GerarEstanteForm() {
  const searchParams = useSearchParams();
  const [barracoes, setBarracoes] = useState<WarehouseBarracaoOption[]>([]);
  const [barracaoId, setBarracaoId] = useState(searchParams.get("barracaoId") ?? "");
  const [estanteCode, setEstanteCode] = useState("");
  const [ldColunas, setLdColunas] = useState("7");
  const [ldLinhas, setLdLinhas] = useState("5");
  const [hasLE, setHasLE] = useState(true);
  const [leColunas, setLeColunas] = useState("7");
  const [leLinhas, setLeLinhas] = useState("5");
  const [type, setType] = useState<"PICK_FACE" | "PULMAO">("PICK_FACE");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateEstanteResult | null>(null);

  useEffect(() => {
    fetchBarracoesList()
      .then(({ barracoes: data }) => {
        setBarracoes(data);
        setBarracaoId((current) => current || data[0]?.id || "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Erro ao carregar barracões"));
  }, []);

  const ld = { colunas: clampInt(ldColunas, 1, 200), linhas: clampInt(ldLinhas, 1, 200) };
  const le = hasLE ? { colunas: clampInt(leColunas, 1, 200), linhas: clampInt(leLinhas, 1, 200) } : null;
  const total = ld.colunas * ld.linhas + (le ? le.colunas * le.linhas : 0);
  const code = estanteCode.trim().toUpperCase();

  const submit = async () => {
    if (!barracaoId) return setErr("Selecione o barracão");
    if (!code) return setErr("Informe o código da estante");
    if (total > MAX_POSITIONS) return setErr(`Máximo de ${MAX_POSITIONS} posições por vez`);
    setSaving(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await generateEstante({ barracaoId, estanteCode: code, ld, le, type }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao gerar estante");
    } finally {
      setSaving(false);
    }
  };

  const sideFields = (
    side: Side,
    colunas: string,
    setColunas: (v: string) => void,
    linhas: string,
    setLinhas: (v: string) => void,
  ) => (
    <div className="grid grid-cols-2 gap-2">
      <label className="block text-sm">
        Colunas no {side}
        <input
          type="number"
          min={1}
          className="mt-1 w-full rounded-lg border px-3 py-2"
          value={colunas}
          onChange={(e) => setColunas(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Linhas no {side}
        <input
          type="number"
          min={1}
          className="mt-1 w-full rounded-lg border px-3 py-2"
          value={linhas}
          onChange={(e) => setLinhas(e.target.value)}
        />
      </label>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <label className="block text-sm">
          Barracão
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={barracaoId}
            onChange={(e) => setBarracaoId(e.target.value)}
          >
            {barracoes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
                {b.name ? ` — ${b.name}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          Estante
          <span className="mt-0.5 block text-xs font-normal text-slate-500">
            Código da gôndola (ex.: A). Se já existir, só as posições que faltam são criadas.
          </span>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 font-mono uppercase"
            value={estanteCode}
            onChange={(e) => setEstanteCode(e.target.value.toUpperCase())}
            placeholder="A"
          />
        </label>

        <div className="space-y-2 rounded-lg border border-cyan-200 bg-cyan-50/40 p-3">
          <p className="text-sm font-semibold text-cyan-900">LD</p>
          {sideFields("LD", ldColunas, setLdColunas, ldLinhas, setLdLinhas)}
        </div>

        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-violet-900">
            <input
              type="checkbox"
              checked={hasLE}
              onChange={(e) => setHasLE(e.target.checked)}
              className="rounded border-slate-300"
            />
            LE (outro lado da estante)
          </label>
          {hasLE ? (
            <>
              {sideFields("LE", leColunas, setLeColunas, leLinhas, setLeLinhas)}
              <p className="text-xs text-violet-900/80">
                As colunas do LE continuam a numeração: começam na {ld.colunas + 1} e vão até a{" "}
                {ld.colunas + (le?.colunas ?? 0)}.
              </p>
            </>
          ) : null}
        </div>

        <div className="text-sm">
          Tipo
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(
              [
                ["PICK_FACE", "Estoque de giro"],
                ["PULMAO", "Pulmão"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setType(id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  type === id ? "border-teal-400 bg-teal-50 text-teal-800" : "bg-white text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          As posições são criadas vazias, com etiqueta provisória ESTANTE-LADO-COLUNA-LINHA (ex.: A-LD-6-3,
          A-LE-8-3). Depois importe a planilha com os códigos de barras reais — a posição é atualizada pelo
          endereço — e associe os SKUs nas posições.
        </p>

        {err ? <p className="text-sm text-red-600">{err}</p> : null}

        <button
          type="button"
          disabled={saving || !code || total > MAX_POSITIONS}
          onClick={submit}
          className="w-full rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Gerando…" : `Gerar ${total} ${total === 1 ? "posição" : "posições"}`}
        </button>

        {result ? (
          <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            <p>
              {result.created} criada{result.created === 1 ? "" : "s"}
              {result.skipped ? ` · ${result.skipped} já existia${result.skipped === 1 ? "" : "m"}` : ""}
              {result.errors.length ? ` · ${result.errors.length} com erro` : ""}
            </p>
            {result.errors.slice(0, 10).map((e) => (
              <p key={e.address} className="text-xs text-red-700">
                {e.address}: {e.message}
              </p>
            ))}
            <div className="flex gap-3 text-xs font-medium">
              <Link
                href={`/gestao-barracao/mapa?barracaoId=${encodeURIComponent(barracaoId)}`}
                className="underline"
              >
                Posicionar no mapa
              </Link>
              <Link href="/gestao-barracao" className="underline">
                Ver localizações
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-slate-700">
          Prévia {code ? `· Estante ${code}` : ""}
          <span className="ml-2 font-normal text-slate-500">vista de frente de cada lado</span>
        </p>
        <SidePreview side="LD" estante={code} firstColuna={1} colunas={ld.colunas} linhas={ld.linhas} />
        {le ? (
          <SidePreview
            side="LE"
            estante={code}
            firstColuna={ld.colunas + 1}
            colunas={le.colunas}
            linhas={le.linhas}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function GestaoBarracaoGerarEstantePage() {
  return (
    <div>
      <PageHeader
        title="Gerar estante"
        description="Crie todas as posições de uma estante informando quantas colunas e linhas tem cada lado (LD e LE)."
      >
        <Link
          href="/gestao-barracao"
          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Voltar
        </Link>
      </PageHeader>
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
        <GerarEstanteForm />
      </Suspense>
    </div>
  );
}
