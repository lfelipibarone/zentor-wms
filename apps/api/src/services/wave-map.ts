import { LocationFace, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { listBarracaoEstantes } from "./floor-plan.js";
import { buildWaveCandidateOrders } from "./pick-wave.js";
import { buildOrderPickProfiles } from "./pick-wave-order-profile.js";
import { loadFloorPlanSpecs } from "./route-engine/index.js";

export class WaveMapError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "WaveMapError";
  }
}

/** Coluna inteira (linha nula) ou uma linha específica de um lado da estante. */
export type WaveMapSelectionEntry = {
  estanteId: string;
  face: "A" | "B";
  coluna: string;
  linha: string | null;
};

export type WaveMapCell = {
  locationId: string;
  barcode: string;
  estanteId: string;
  face: "A" | "B";
  coluna: string;
  linha: string;
  orderIds: string[];
};

const MAX_CANDIDATE_ORDERS = 500;
const MAX_SELECTION = 3000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const byCode = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

export function selectionKey(e: Pick<WaveMapSelectionEntry, "estanteId" | "face" | "coluna">, linha: string | null) {
  return `${e.estanteId}|${e.face}|${e.coluna}|${linha ?? "*"}`;
}

/** Pedidos com pelo menos um item numa coluna inteira ou linha selecionada. */
export function ordersMatchingSelection(cells: WaveMapCell[], selection: WaveMapSelectionEntry[]): string[] {
  const keys = new Set(selection.map((s) => selectionKey(s, s.linha)));
  const out = new Set<string>();
  for (const c of cells) {
    if (keys.has(selectionKey(c, null)) || keys.has(selectionKey(c, c.linha))) {
      for (const id of c.orderIds) out.add(id);
    }
  }
  return [...out];
}

export function parseSelection(raw: unknown, estanteIds: Set<string>): WaveMapSelectionEntry[] {
  if (!Array.isArray(raw)) throw new WaveMapError("Seleção inválida");
  if (raw.length === 0) throw new WaveMapError("Selecione ao menos uma coluna ou linha no mapa");
  if (raw.length > MAX_SELECTION) throw new WaveMapError(`Máximo de ${MAX_SELECTION} colunas/linhas por onda`);
  const seen = new Map<string, WaveMapSelectionEntry>();
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    const estanteId = typeof r.estanteId === "string" ? r.estanteId : "";
    const face = r.face === "A" || r.face === "B" ? r.face : null;
    const coluna = typeof r.coluna === "string" ? r.coluna.trim() : "";
    const linha = typeof r.linha === "string" && r.linha.trim() ? r.linha.trim() : null;
    if (!estanteIds.has(estanteId) || !face || !coluna || coluna.length > 20 || (linha?.length ?? 0) > 20) {
      throw new WaveMapError("Seleção com coluna ou linha que não é deste barracão");
    }
    const entry: WaveMapSelectionEntry = { estanteId, face, coluna, linha };
    seen.set(selectionKey(entry, linha), entry);
  }
  return [...seen.values()];
}

async function barracaoEstanteIds(tenantId: string, barracaoId: string): Promise<Set<string>> {
  const rows = await prisma.warehouseEstante.findMany({
    where: { tenantId, corredor: { setor: { barracaoId } } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

async function assertBarracao(tenantId: string, barracaoId: string) {
  const b = await prisma.warehouseBarracao.findFirst({
    where: { id: barracaoId, tenantId },
    select: { id: true, code: true, name: true },
  });
  if (!b) throw new WaveMapError("Barracão não encontrado", 404);
  return b;
}

/** Colunas de cada lado das estantes do barracão, com os códigos das linhas. */
async function listColunaLinhas(tenantId: string, estanteIds: string[]) {
  const linhas = await prisma.warehouseLinha.findMany({
    where: { tenantId, active: true, coluna: { estanteId: { in: estanteIds } } },
    select: { code: true, face: true, coluna: { select: { code: true, estanteId: true } } },
  });
  const map = new Map<string, { estanteId: string; face: "A" | "B"; coluna: string; linhas: Set<string> }>();
  for (const l of linhas) {
    const key = `${l.coluna.estanteId}|${l.face}|${l.coluna.code}`;
    const entry = map.get(key) ?? { estanteId: l.coluna.estanteId, face: l.face, coluna: l.coluna.code, linhas: new Set() };
    entry.linhas.add(l.code);
    map.set(key, entry);
  }
  return [...map.values()]
    .map((c) => ({ ...c, linhas: [...c.linhas].sort(byCode) }))
    .sort((a, b) => a.estanteId.localeCompare(b.estanteId) || a.face.localeCompare(b.face) || byCode(a.coluna, b.coluna));
}

/** Onde cada pedido pendente (sem onda) vai ser separado, por coluna/linha das gôndolas do barracão. */
export async function buildWaveMapDemand(
  tenantId: string,
  barracaoId: string,
  opts?: { marketplace?: string; estanteIds?: Set<string> },
) {
  const estanteIds = opts?.estanteIds ?? (await barracaoEstanteIds(tenantId, barracaoId));
  const orders = await buildWaveCandidateOrders(tenantId, {
    marketplace: opts?.marketplace,
    maxOrders: MAX_CANDIDATE_ORDERS,
    onlyDeadlineToday: false,
  });
  const profiles = await buildOrderPickProfiles(tenantId, orders);
  const locationIds = [...new Set([...profiles.values()].flatMap((p) => p.pickLocationIds))];
  const locations = locationIds.length
    ? await prisma.location.findMany({
        where: { tenantId, id: { in: locationIds }, estanteId: { in: [...estanteIds] } },
        select: {
          id: true,
          barcode: true,
          estanteId: true,
          face: true,
          coluna: { select: { code: true } },
          linha: { select: { code: true } },
        },
      })
    : [];
  const byId = new Map(locations.map((l) => [l.id, l]));

  const cells = new Map<string, WaveMapCell>();
  const mappedOrderIds = new Set<string>();
  for (const [orderId, profile] of profiles) {
    for (const locId of profile.pickLocationIds) {
      const loc = byId.get(locId);
      if (!loc?.estanteId || !loc.coluna || !loc.linha) continue;
      const cell = cells.get(loc.id) ?? {
        locationId: loc.id,
        barcode: loc.barcode,
        estanteId: loc.estanteId,
        face: loc.face === LocationFace.B ? "B" : "A",
        coluna: loc.coluna.code,
        linha: loc.linha.code,
        orderIds: [],
      };
      if (!cell.orderIds.includes(orderId)) cell.orderIds.push(orderId);
      cells.set(loc.id, cell);
      mappedOrderIds.add(orderId);
    }
  }

  const mappedOrders = orders.filter((o) => mappedOrderIds.has(o.id));
  return {
    cells: [...cells.values()],
    orders: mappedOrders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      customerName: o.customerName,
      marketplace: o.marketplace,
      priority: o.priority,
      collectionDeadline: o.collectionDeadline,
      itemCount: o.items.length,
    })),
    candidateCount: orders.length,
    unmappedOrderCount: orders.length - mappedOrders.length,
  };
}

export async function listWaveMapBarracoes(tenantId: string) {
  const plans = await prisma.warehouseFloorPlan.findMany({
    where: { tenantId },
    select: { barracao: { select: { id: true, code: true, name: true } } },
  });
  return plans.map((p) => p.barracao).sort((a, b) => byCode(a.code, b.code));
}

/** Planta, estrutura de colunas/linhas, demanda dos pedidos pendentes e ondas fixas de um barracão. */
export async function getWaveMap(tenantId: string, opts?: { barracaoId?: string; marketplace?: string }) {
  const barracoes = await listWaveMapBarracoes(tenantId);
  const barracaoId = opts?.barracaoId || barracoes[0]?.id;
  if (!barracaoId) return { barracoes, barracao: null };

  const barracao = await assertBarracao(tenantId, barracaoId);
  const [specs, estantes] = await Promise.all([
    loadFloorPlanSpecs(tenantId, barracaoId),
    listBarracaoEstantes(tenantId, barracaoId),
  ]);
  const plan = specs[0];
  if (!plan) return { barracoes, barracao: null };

  const estanteIds = new Set(estantes.map((e) => e.id));
  const [colunas, demand, templates] = await Promise.all([
    listColunaLinhas(tenantId, [...estanteIds]),
    buildWaveMapDemand(tenantId, barracaoId, { marketplace: opts?.marketplace, estanteIds }),
    listWaveTemplates(tenantId, barracaoId),
  ]);

  return {
    barracoes,
    barracao,
    plan: {
      widthCells: plan.widthCells,
      heightCells: plan.heightCells,
      cellSizeCm: plan.cellSizeCm,
      elements: plan.elements,
    },
    estantes,
    colunas,
    ...demand,
    templates,
  };
}

const templateSelect = {
  id: true,
  barracaoId: true,
  name: true,
  color: true,
  active: true,
  selection: true,
  updatedAt: true,
  _count: { select: { waves: true } },
} satisfies Prisma.PickWaveTemplateSelect;

function toTemplateDto(t: Prisma.PickWaveTemplateGetPayload<{ select: typeof templateSelect }>) {
  return {
    id: t.id,
    barracaoId: t.barracaoId,
    name: t.name,
    color: t.color,
    active: t.active,
    selection: (Array.isArray(t.selection) ? t.selection : []) as WaveMapSelectionEntry[],
    waveCount: t._count.waves,
    updatedAt: t.updatedAt,
  };
}

export async function listWaveTemplates(tenantId: string, barracaoId?: string) {
  const rows = await prisma.pickWaveTemplate.findMany({
    where: { tenantId, ...(barracaoId ? { barracaoId } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: templateSelect,
  });
  return rows.map(toTemplateDto);
}

export type WaveTemplateInput = {
  barracaoId?: string;
  name?: string;
  color?: string;
  active?: boolean;
  selection?: unknown;
};

function parseName(v: unknown): string {
  const name = typeof v === "string" ? v.trim().slice(0, 60) : "";
  if (!name) throw new WaveMapError("Dê um nome para a onda fixa");
  return name;
}

function parseColor(v: unknown): string {
  return typeof v === "string" && COLOR_RE.test(v) ? v : "#0d9488";
}

export async function createWaveTemplate(tenantId: string, input: WaveTemplateInput) {
  const barracaoId = typeof input.barracaoId === "string" ? input.barracaoId : "";
  await assertBarracao(tenantId, barracaoId);
  const selection = parseSelection(input.selection, await barracaoEstanteIds(tenantId, barracaoId));
  const row = await prisma.pickWaveTemplate.create({
    data: {
      tenantId,
      barracaoId,
      name: parseName(input.name),
      color: parseColor(input.color),
      active: input.active ?? true,
      selection: selection as unknown as Prisma.InputJsonValue,
    },
    select: templateSelect,
  });
  return toTemplateDto(row);
}

async function findTemplate(tenantId: string, id: string) {
  const t = await prisma.pickWaveTemplate.findFirst({ where: { id, tenantId } });
  if (!t) throw new WaveMapError("Onda fixa não encontrada", 404);
  return t;
}

export async function updateWaveTemplate(tenantId: string, id: string, input: WaveTemplateInput) {
  const current = await findTemplate(tenantId, id);
  const data: Prisma.PickWaveTemplateUpdateInput = {};
  if (input.name !== undefined) data.name = parseName(input.name);
  if (input.color !== undefined) data.color = parseColor(input.color);
  if (typeof input.active === "boolean") data.active = input.active;
  if (input.selection !== undefined) {
    const selection = parseSelection(input.selection, await barracaoEstanteIds(tenantId, current.barracaoId));
    data.selection = selection as unknown as Prisma.InputJsonValue;
  }
  const row = await prisma.pickWaveTemplate.update({ where: { id }, data, select: templateSelect });
  return toTemplateDto(row);
}

export async function deleteWaveTemplate(tenantId: string, id: string) {
  await findTemplate(tenantId, id);
  await prisma.pickWaveTemplate.delete({ where: { id } });
}
