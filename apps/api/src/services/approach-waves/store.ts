import { ApproachWaveKind, LocationFace, type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { buildFloorGrid, cellIndex, isWalkable } from "../route-engine/floor-grid.js";
import { loadFloorPlanSpecs } from "../route-engine/index.js";
import { gondolaCode } from "../warehouse-layout.js";
import { findStopOverlaps, type ApproachWaveDef } from "./matching.js";

export class ApproachWaveError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "ApproachWaveError";
  }
}

export type ApproachWaveInput = {
  id?: string;
  name: string;
  color: string;
  active?: boolean;
  startX?: number | null;
  startY?: number | null;
  stops: Array<{ estanteId: string; face: "A" | "B"; colunaFrom?: number | null; colunaTo?: number | null }>;
};

export type ApproachWaveDto = {
  id: string;
  barracaoId: string;
  kind: ApproachWaveKind;
  name: string;
  color: string;
  sortOrder: number;
  active: boolean;
  startX: number | null;
  startY: number | null;
  stops: Array<{
    id: string;
    position: number;
    estanteId: string;
    estanteCode: string;
    face: "A" | "B";
    colunaFrom: number | null;
    colunaTo: number | null;
  }>;
};

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_WAVES = 50;
const MAX_STOPS = 200;
const waveInclude = { stops: { orderBy: { position: "asc" as const } } } satisfies Prisma.ApproachWaveInclude;

export function parseKind(v: unknown): ApproachWaveKind {
  if (v === "PICKING" || v === "PACKING") return v;
  throw new ApproachWaveError("kind deve ser PICKING ou PACKING");
}

function optionalColuna(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 9999) throw new ApproachWaveError("Coluna inválida na parada");
  return n;
}

async function estanteCodes(tenantId: string, barracaoId: string): Promise<Map<string, string>> {
  const estantes = await prisma.warehouseEstante.findMany({
    where: { tenantId, corredor: { setor: { barracaoId } } },
    select: { id: true, code: true, corredor: { select: { code: true } } },
  });
  return new Map(estantes.map((e) => [e.id, gondolaCode(e.code, e.corredor.code)]));
}

function toDto(
  w: Prisma.ApproachWaveGetPayload<{ include: typeof waveInclude }>,
  codes: Map<string, string>,
): ApproachWaveDto {
  return {
    id: w.id,
    barracaoId: w.barracaoId,
    kind: w.kind,
    name: w.name,
    color: w.color,
    sortOrder: w.sortOrder,
    active: w.active,
    startX: w.startX,
    startY: w.startY,
    stops: w.stops.map((s) => ({
      id: s.id,
      position: s.position,
      estanteId: s.estanteId,
      estanteCode: codes.get(s.estanteId) ?? "?",
      face: s.face,
      colunaFrom: s.colunaFrom,
      colunaTo: s.colunaTo,
    })),
  };
}

export async function listApproachWaves(tenantId: string, barracaoId: string, kind: ApproachWaveKind) {
  const [waves, codes] = await Promise.all([
    prisma.approachWave.findMany({
      where: { tenantId, barracaoId, kind },
      orderBy: { sortOrder: "asc" },
      include: waveInclude,
    }),
    estanteCodes(tenantId, barracaoId),
  ]);
  return waves.map((w) => toDto(w, codes));
}

export async function listTenantApproachWaves(tenantId: string, kind: ApproachWaveKind) {
  return prisma.approachWave.findMany({
    where: { tenantId, kind, active: true },
    orderBy: [{ barracaoId: "asc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, color: true, barracaoId: true },
  });
}

/** Ondas ativas do tipo, de todos os barracões, no formato das regras puras. */
export async function loadApproachWaveDefs(tenantId: string, kind: ApproachWaveKind): Promise<ApproachWaveDef[]> {
  const waves = await prisma.approachWave.findMany({
    where: { tenantId, kind, active: true },
    orderBy: { sortOrder: "asc" },
    include: waveInclude,
  });
  return waves.map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color,
    sortOrder: w.sortOrder,
    stops: w.stops.map((s) => ({ estanteId: s.estanteId, face: s.face, colunaFrom: s.colunaFrom, colunaTo: s.colunaTo })),
  }));
}

export async function saveApproachWaves(
  tenantId: string,
  barracaoId: string,
  kind: ApproachWaveKind,
  input: ApproachWaveInput[],
) {
  const barracao = await prisma.warehouseBarracao.findFirst({ where: { id: barracaoId, tenantId }, select: { id: true } });
  if (!barracao) throw new ApproachWaveError("Barracão não encontrado", 404);
  if (!Array.isArray(input)) throw new ApproachWaveError("waves deve ser uma lista");
  if (input.length > MAX_WAVES) throw new ApproachWaveError(`Máximo de ${MAX_WAVES} ondas por tipo`);

  const [codes, [plan]] = await Promise.all([estanteCodes(tenantId, barracaoId), loadFloorPlanSpecs(tenantId, barracaoId)]);
  const grid = plan ? buildFloorGrid(plan) : null;

  const clean = input.map((w, i) => {
    const name = String(w.name ?? "").trim().slice(0, 60);
    if (!name) throw new ApproachWaveError(`Onda ${i + 1}: informe o nome`);
    if (!COLOR_RE.test(String(w.color ?? ""))) throw new ApproachWaveError(`${name}: cor inválida`);
    const hasStart = w.startX != null && w.startY != null;
    const startX = hasStart ? Math.round(Number(w.startX)) : null;
    const startY = hasStart ? Math.round(Number(w.startY)) : null;
    if (hasStart) {
      if (!grid) throw new ApproachWaveError("Salve a planta do barracão antes de marcar a saída");
      if (!isWalkable(grid, cellIndex(grid, startX!, startY!))) {
        throw new ApproachWaveError(`${name}: a saída precisa ficar numa célula livre da planta`);
      }
    }
    const stops = Array.isArray(w.stops) ? w.stops : [];
    if (stops.length > MAX_STOPS) throw new ApproachWaveError(`${name}: máximo de ${MAX_STOPS} paradas`);
    return {
      id: typeof w.id === "string" && w.id ? w.id : undefined,
      name,
      color: w.color.toLowerCase(),
      active: w.active ?? true,
      startX,
      startY,
      sortOrder: i,
      stops: stops.map((s, position) => {
        if (!codes.has(s.estanteId)) throw new ApproachWaveError(`${name}: estante da parada ${position + 1} não é deste barracão`);
        if (s.face !== "A" && s.face !== "B") throw new ApproachWaveError(`${name}: lado inválido na parada ${position + 1}`);
        return {
          position,
          estanteId: s.estanteId,
          face: s.face === "B" ? LocationFace.B : LocationFace.A,
          colunaFrom: optionalColuna(s.colunaFrom),
          colunaTo: optionalColuna(s.colunaTo),
        };
      }),
    };
  });

  const overlaps = findStopOverlaps(
    clean.filter((w) => w.active).map((w, i) => ({ id: String(i), name: w.name, color: w.color, sortOrder: i, stops: w.stops })),
    (id) => codes.get(id) ?? "?",
  );
  if (overlaps.length > 0) throw new ApproachWaveError(`Paradas repetidas: ${overlaps.join("; ")}`);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.approachWave.findMany({ where: { tenantId, barracaoId, kind }, select: { id: true } });
    const existingIds = new Set(existing.map((e) => e.id));
    const keep = new Set(clean.map((w) => w.id).filter((id): id is string => Boolean(id && existingIds.has(id))));
    await tx.approachWave.deleteMany({ where: { tenantId, barracaoId, kind, id: { notIn: [...keep] } } });
    for (const w of clean) {
      const data = { name: w.name, color: w.color, active: w.active, startX: w.startX, startY: w.startY, sortOrder: w.sortOrder };
      const saved =
        w.id && keep.has(w.id)
          ? await tx.approachWave.update({ where: { id: w.id }, data })
          : await tx.approachWave.create({ data: { ...data, tenantId, barracaoId, kind } });
      await tx.approachWaveStop.deleteMany({ where: { approachWaveId: saved.id } });
      if (w.stops.length > 0) {
        await tx.approachWaveStop.createMany({ data: w.stops.map((s) => ({ ...s, approachWaveId: saved.id })) });
      }
    }
  });

  return listApproachWaves(tenantId, barracaoId, kind);
}
