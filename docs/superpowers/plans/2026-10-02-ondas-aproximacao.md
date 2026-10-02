# Ondas de aproximação — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar áreas de trabalho (saída + paradas em ordem) no mapa do barracão, separadas para picking e packing. Usá-las para dividir o lote de picking em partes por área, com um separador por parte, e para filtrar e ordenar a fila do packing.

**Architecture:**
- A lógica de área (pertencimento, sequência, repartição, área do pedido) fica em funções puras em `apps/api/src/services/approach-waves/`, testadas com `node --test`.
- O Prisma ganha `ApproachWave`, `ApproachWaveStop`, `PickWavePart` e `PickWaveLine.partId`.
- A liberação, o aceite e a fila do packing consomem essas funções.
- Na web, o mapa ganha o modo "Ondas de aproximação"; no celular (Expo), a lista de ondas mostra as partes.

**Tech Stack:** Fastify + Prisma 6 + Postgres (`apps/api`), Next 15 / React 19 / Tailwind (`apps/web`), Expo Router + React Query (`apps/mobile`), `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-02-ondas-aproximacao-design.md`

## Global Constraints

**Banco de dados**
- Não tocar no banco remoto (177.7.39.127). Só o Postgres local do docker `wms-postgres`, porta 5435, banco `wms`. Antes de qualquer comando Prisma que escreva, confirme que o host do `DATABASE_URL` é `localhost:5435`.
- Não imprimir segredos do `.env`.
- Ações destrutivas do Prisma (`migrate reset`, `db push --accept-data-loss`, drop) só com o consentimento explícito do usuário. Esta feature é só aditiva.
- Não mexer em containers de outros projetos (o promo na 5432).
- Apagar os dados de teste criados no banco local ao final da verificação manual.

**Git**
- Não commitar sem o usuário autorizar. Quando autorizado, um commit por tarefa com a mensagem indicada.

**Comandos de verificação**
- Testes da API: `cd apps/api && npm test`. Todo arquivo de teste novo entra no script `test` do `apps/api/package.json`.
- Typecheck:
  - API: `cd apps/api && node_modules/.bin/tsc --noEmit`
  - Web: `cd apps/web && node_modules/.bin/tsc --noEmit`
  - Celular: `cd apps/mobile && node_modules/.bin/tsc --noEmit`

**Ambiente de desenvolvimento**
- O servidor de dev já roda (`pnpm run dev`, terminal 1). A API usa `tsx watch`: para reiniciar, basta salvar (touch) um arquivo em `apps/api/src`.
- Login local: `adm@wms.local` / `admin123` em `http://localhost:3000`.

**Convenções**
- Face `A` = LD e `B` = LE em todo lugar.
- A coluna da localização vem de `colunaFromRow(location.row)` (`apps/api/src/services/location-route.ts`).
- Textos de tela em português, no tom das telas atuais.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
| :--- | :--- |
| `apps/api/prisma/schema.prisma` | Enum `ApproachWaveKind`, modelos novos, `PickWaveLine.partId` e as relações |
| `apps/api/prisma/migrations/20261002120000_approach_waves/migration.sql` | SQL aditivo equivalente |
| `apps/api/src/services/approach-waves/matching.ts` | Puro: parada contém a localização, sequência, sobreposição, rótulo |
| `apps/api/src/services/approach-waves/parts.ts` | Puro: repartir linhas em partes, ordenar pela sequência, área do pedido no packing, ordem da fila |
| `apps/api/src/services/approach-waves/approach-waves.test.ts` | Testes dos dois arquivos puros |
| `apps/api/src/services/approach-waves/store.ts` | Prisma: listar, salvar (validando) e carregar as definições |
| `apps/api/src/routes/approach-waves.ts` | Rotas web do cadastro e da lista para o packing |
| `apps/api/src/services/pick-wave-partition.ts` (+ teste) | Estratégias `BY_APPROACH` e `SINGLE_WAVE` |
| `apps/api/src/services/wave-settings.ts` | Aceitar as estratégias novas |
| `apps/api/src/services/pick-wave.ts` | Partes na liberação, no anexo e na prévia; aceite por parte; operador por parte; ordenação |
| `apps/api/src/services/pick-wave-pick.ts`, `pick-wave-sort.ts` | Checar o operador da parte |
| `apps/api/src/routes/mobile.ts` | `partId` nas rotas de onda; partes na lista |
| `apps/api/src/routes/web.ts` | Registrar as rotas; tipos de estratégia; filtro da fila do packing |
| `apps/api/src/services/order-packing.ts` | Filtrar e ordenar a fila unificada por onda de packing |
| `apps/web/lib/api/approach-waves.ts` | Cliente HTTP |
| `apps/web/components/warehouse/floor-plan/approach-geometry.ts` | Puro: clique → parada, retângulos da parada, rótulo |
| `apps/web/components/warehouse/floor-plan/approach-overlay.tsx` | Desenho das ondas no SVG |
| `apps/web/components/warehouse/floor-plan/approach-waves-panel.tsx` | Painel do cadastro |
| `apps/web/components/warehouse/floor-plan/floor-plan-canvas.tsx` | `overlay` e `onPointClick` |
| `apps/web/components/warehouse/floor-plan/floor-plan-editor.tsx` | Modo `approach` |
| `apps/web/lib/api/waves.ts`, `app/(dashboard)/ondas/page.tsx`, `ondas/configuracoes/page.tsx` | Modos novos e partes na prévia |
| `apps/web/lib/api/operations.ts`, `app/(dashboard)/packing/page.tsx` | Seletor de área no packing |
| `apps/mobile/lib/api.ts`, `hooks/useWavePicking.ts`, `app/wave-picking/index.tsx`, `components/WavePickingPanel.tsx` | Partes no celular |
| `docs/logica-ondas.md` | Documentação de operação |

---

### Task 1: Modelo de dados e migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261002120000_approach_waves/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `ApproachWave`, `ApproachWaveStop` e `PickWavePart`; enum `ApproachWaveKind` (`PICKING` | `PACKING`); `PickWaveLine.partId: string | null`; relações `PickWave.parts`, `PickWaveLine.part` e `PickWavePart.acceptedBy` (User, relação `"WavePartAcceptedBy"`).

- [ ] **Step 1: Enum.** Logo depois do `enum FloorElementType { … }`, adicione:

```prisma
enum ApproachWaveKind {
  PICKING
  PACKING
}
```

- [ ] **Step 2: Relações inversas.**
  - No `model Tenant`, junto das outras relações: `approachWaves ApproachWave[]`.
  - No `model User`, logo após `acceptedWaves PickWave[] @relation("WaveAcceptedBy")`: `acceptedWaveParts PickWavePart[] @relation("WavePartAcceptedBy")`.
  - No `model WarehouseBarracao`, após `floorPlan WarehouseFloorPlan?`: `approachWaves ApproachWave[]`.
  - No `model WarehouseEstante`, após `floorElementsB …`: `approachStops ApproachWaveStop[]`.

- [ ] **Step 3: Modelos novos de cadastro.** Logo depois do `model WarehouseFloorElement { … }`, adicione:

```prisma
/// Onda de aproximação: área fixa de trabalho com saída e paradas em ordem (picking ou packing).
model ApproachWave {
  id         String           @id @default(cuid())
  tenantId   String
  barracaoId String
  kind       ApproachWaveKind
  name       String
  color      String
  sortOrder  Int              @default(0)
  active     Boolean          @default(true)
  /// Célula de saída na planta do barracão (nulo = sem saída marcada).
  startX     Int?
  startY     Int?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  tenant   Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  barracao WarehouseBarracao  @relation(fields: [barracaoId], references: [id], onDelete: Cascade)
  stops    ApproachWaveStop[]
  parts    PickWavePart[]

  @@index([tenantId, kind])
  @@index([barracaoId])
  @@map("approach_waves")
}

/// Parada: um lado (face) de uma estante, inteiro ou numa faixa; colunaFrom > colunaTo anda em ordem decrescente.
model ApproachWaveStop {
  id             String       @id @default(cuid())
  approachWaveId String
  position       Int
  estanteId      String
  face           LocationFace
  colunaFrom     Int?
  colunaTo       Int?

  approachWave ApproachWave     @relation(fields: [approachWaveId], references: [id], onDelete: Cascade)
  estante      WarehouseEstante @relation(fields: [estanteId], references: [id], onDelete: Cascade)

  @@index([approachWaveId])
  @@index([estanteId])
  @@map("approach_wave_stops")
}
```

- [ ] **Step 4: Partes do lote.**
  - No `model PickWave`, após `lines PickWaveLine[]`: `parts PickWavePart[]`.
  - Logo depois do `model PickWave { … }`, adicione:

```prisma
/// Parte do lote de uma onda de aproximação de picking; cada parte é aceita por um separador.
model PickWavePart {
  id             String    @id @default(cuid())
  waveId         String
  approachWaveId String?
  name           String
  color          String?
  sortOrder      Int       @default(0)
  acceptedById   String?
  acceptedAt     DateTime?
  createdAt      DateTime  @default(now())

  wave         PickWave       @relation(fields: [waveId], references: [id], onDelete: Cascade)
  approachWave ApproachWave?  @relation(fields: [approachWaveId], references: [id], onDelete: SetNull)
  acceptedBy   User?          @relation("WavePartAcceptedBy", fields: [acceptedById], references: [id], onDelete: SetNull)
  lines        PickWaveLine[]

  @@index([waveId])
  @@index([acceptedById])
  @@map("pick_wave_parts")
}
```

- [ ] **Step 5: Vínculo da linha com a parte.** No `model PickWaveLine`:
  - Após `waveId String`: `partId String?`.
  - Após a relação `wave`: `part PickWavePart? @relation(fields: [partId], references: [id], onDelete: SetNull)`.
  - Junto dos índices: `@@index([partId])`.

- [ ] **Step 6: Migration.** Crie `apps/api/prisma/migrations/20261002120000_approach_waves/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "ApproachWaveKind" AS ENUM ('PICKING', 'PACKING');

-- CreateTable
CREATE TABLE "approach_waves" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "barracaoId" TEXT NOT NULL,
    "kind" "ApproachWaveKind" NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startX" INTEGER,
    "startY" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approach_waves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approach_wave_stops" (
    "id" TEXT NOT NULL,
    "approachWaveId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "estanteId" TEXT NOT NULL,
    "face" "LocationFace" NOT NULL,
    "colunaFrom" INTEGER,
    "colunaTo" INTEGER,

    CONSTRAINT "approach_wave_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_wave_parts" (
    "id" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "approachWaveId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pick_wave_parts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "pick_wave_lines" ADD COLUMN "partId" TEXT;

-- CreateIndex
CREATE INDEX "approach_waves_tenantId_kind_idx" ON "approach_waves"("tenantId", "kind");
CREATE INDEX "approach_waves_barracaoId_idx" ON "approach_waves"("barracaoId");
CREATE INDEX "approach_wave_stops_approachWaveId_idx" ON "approach_wave_stops"("approachWaveId");
CREATE INDEX "approach_wave_stops_estanteId_idx" ON "approach_wave_stops"("estanteId");
CREATE INDEX "pick_wave_parts_waveId_idx" ON "pick_wave_parts"("waveId");
CREATE INDEX "pick_wave_parts_acceptedById_idx" ON "pick_wave_parts"("acceptedById");
CREATE INDEX "pick_wave_lines_partId_idx" ON "pick_wave_lines"("partId");

-- AddForeignKey
ALTER TABLE "approach_waves" ADD CONSTRAINT "approach_waves_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approach_waves" ADD CONSTRAINT "approach_waves_barracaoId_fkey" FOREIGN KEY ("barracaoId") REFERENCES "warehouse_barracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approach_wave_stops" ADD CONSTRAINT "approach_wave_stops_approachWaveId_fkey" FOREIGN KEY ("approachWaveId") REFERENCES "approach_waves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approach_wave_stops" ADD CONSTRAINT "approach_wave_stops_estanteId_fkey" FOREIGN KEY ("estanteId") REFERENCES "warehouse_estantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pick_wave_parts" ADD CONSTRAINT "pick_wave_parts_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "pick_waves"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pick_wave_parts" ADD CONSTRAINT "pick_wave_parts_approachWaveId_fkey" FOREIGN KEY ("approachWaveId") REFERENCES "approach_waves"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pick_wave_parts" ADD CONSTRAINT "pick_wave_parts_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_partId_fkey" FOREIGN KEY ("partId") REFERENCES "pick_wave_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 7: Validar e gerar o client.**
  - Run: `cd apps/api && npx prisma validate && npx prisma generate`
  - Expected: "The schema … is valid" e "Generated Prisma Client".

- [ ] **Step 8: Aplicar no banco local (somente local).**
  - Run: `cd apps/api && node --env-file .env -e "console.log(new URL(process.env.DATABASE_URL).host)"`
  - Expected: `localhost:5435`. Se for outro host, PARE e avise o usuário.
  - Run: `cd apps/api && npx prisma db push --skip-generate`
  - Expected: "Your database is now in sync". Não deve pedir `--accept-data-loss`; se pedir, PARE.

- [ ] **Step 9: Typecheck da API.**
  - Run: `cd apps/api && node_modules/.bin/tsc --noEmit`
  - Expected: sem erros.

- [ ] **Step 10: Commit (com autorização).**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261002120000_approach_waves
git commit -m "feat(ondas): modelo de ondas de aproximação e partes do lote"
```

---

### Task 2: Lógica pura (pertencimento, sequência, partes, área do packing)

**Files:**
- Create: `apps/api/src/services/approach-waves/matching.ts`
- Create: `apps/api/src/services/approach-waves/parts.ts`
- Test: `apps/api/src/services/approach-waves/approach-waves.test.ts`
- Modify: `apps/api/package.json` (script `test`)

**Interfaces:**
- Produces (`matching.ts`):
  - `type Face = "A" | "B"`
  - `type ApproachStop = { estanteId: string; face: Face; colunaFrom: number | null; colunaTo: number | null }`
  - `type ApproachWaveDef = { id: string; name: string; color: string; sortOrder: number; stops: ApproachStop[] }`
  - `type ZoneLocation = { estanteId?: string | null; face?: string | null; row: string }`
  - `type ZoneMatch = { waveId: string; stopIndex: number; colunaRank: number }`
  - `colunaRankInStop(stop, loc): number | null`
  - `matchLocation(waves, loc): ZoneMatch | null`
  - `sequenceKey(match): number`
  - `sequenceKeyIn(wave, loc): number | null`
  - `stopsOverlap(a, b): boolean`
  - `findStopOverlaps(waves, code: (estanteId: string) => string): string[]`
  - `formatStop(stop, code): string`
- Produces (`parts.ts`):
  - `type PartPlan<T> = { approachWaveId: string | null; name: string; color: string | null; sortOrder: number; lines: T[] }`
  - `planWaveParts<T extends { location: ZoneLocation }>(lines: T[], waves: ApproachWaveDef[]): PartPlan<T>[]`
  - `sortBySequence<T>(items: T[], wave: ApproachWaveDef, locate: (item: T) => ZoneLocation | null): T[]`
  - `packingZoneFor(items: Array<{ quantity: number; location: ZoneLocation | null }>, waves: ApproachWaveDef[]): string | null`
  - `sortByUrgencyThenSequence<T>(items: T[], urgency: (item: T) => number, key: (item: T) => number | null): T[]`
  - `NO_ZONE = "none"`

- [ ] **Step 1: Escrever os testes que falham.** Crie `apps/api/src/services/approach-waves/approach-waves.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  colunaRankInStop,
  findStopOverlaps,
  formatStop,
  matchLocation,
  sequenceKeyIn,
  type ApproachWaveDef,
} from "./matching.js";
import { packingZoneFor, planWaveParts, sortBySequence, sortByUrgencyThenSequence } from "./parts.js";

const C = "est-c";
const D = "est-d";
const E = "est-e";
const K = "est-k";
const code = (id: string) => id.replace("est-", "").toUpperCase();
const loc = (estanteId: string, face: "A" | "B", coluna: number) => ({ estanteId, face, row: `${coluna}-1` });

const onda1: ApproachWaveDef = {
  id: "w1",
  name: "Onda 1",
  color: "#2563eb",
  sortOrder: 0,
  stops: [
    { estanteId: C, face: "B", colunaFrom: 1, colunaTo: 7 },
    { estanteId: C, face: "B", colunaFrom: 8, colunaTo: 14 },
    { estanteId: D, face: "A", colunaFrom: 8, colunaTo: 14 },
    { estanteId: E, face: "A", colunaFrom: 14, colunaTo: 8 },
    { estanteId: E, face: "A", colunaFrom: 7, colunaTo: 1 },
  ],
};
const onda2: ApproachWaveDef = {
  id: "w2",
  name: "Onda 2",
  color: "#16a34a",
  sortOrder: 1,
  stops: [
    { estanteId: D, face: "A", colunaFrom: 1, colunaTo: 7 },
    { estanteId: K, face: "A", colunaFrom: null, colunaTo: null },
  ],
};

describe("ondas de aproximação — pertencimento", () => {
  it("acha a parada pela estante, lado e faixa", () => {
    assert.deepEqual(matchLocation([onda1, onda2], loc(C, "B", 9)), { waveId: "w1", stopIndex: 1, colunaRank: 1 });
    assert.deepEqual(matchLocation([onda1, onda2], loc(D, "A", 3)), { waveId: "w2", stopIndex: 0, colunaRank: 2 });
  });

  it("lado errado, fora da faixa ou sem estante não pertence", () => {
    assert.equal(matchLocation([onda1], loc(C, "A", 3)), null);
    assert.equal(matchLocation([onda1], loc(D, "A", 3)), null);
    assert.equal(matchLocation([onda1], { estanteId: null, face: "A", row: "3-1" }), null);
  });

  it("faixa invertida anda em ordem decrescente", () => {
    const stop = onda1.stops[3]!;
    assert.equal(colunaRankInStop(stop, loc(E, "A", 14)), 0);
    assert.equal(colunaRankInStop(stop, loc(E, "A", 8)), 6);
    assert.equal(colunaRankInStop(stop, loc(E, "A", 7)), null);
  });

  it("estante inteira aceita qualquer coluna", () => {
    assert.deepEqual(matchLocation([onda2], loc(K, "A", 22)), { waveId: "w2", stopIndex: 1, colunaRank: 22 });
  });

  it("sequência: primeiro a parada, depois a coluna", () => {
    const a = sequenceKeyIn(onda1, loc(C, "B", 14))!;
    const b = sequenceKeyIn(onda1, loc(D, "A", 8))!;
    const c = sequenceKeyIn(onda1, loc(E, "A", 14))!;
    const d = sequenceKeyIn(onda1, loc(E, "A", 3))!;
    assert.ok(a < b && b < c && c < d);
    assert.equal(sequenceKeyIn(onda1, loc(K, "A", 1)), null);
  });

  it("aponta paradas sobrepostas entre ondas", () => {
    assert.deepEqual(findStopOverlaps([onda1, onda2], code), []);
    const clash: ApproachWaveDef = { ...onda2, stops: [{ estanteId: C, face: "B", colunaFrom: 5, colunaTo: 9 }] };
    assert.deepEqual(findStopOverlaps([onda1, clash], code), [
      'C LE 1→7 está em "Onda 1" e em "Onda 2"',
      'C LE 8→14 está em "Onda 1" e em "Onda 2"',
    ]);
  });

  it("formata a parada", () => {
    assert.equal(formatStop(onda1.stops[3]!, code), "E LD 14→8");
    assert.equal(formatStop(onda2.stops[1]!, code), "K LD");
  });
});

describe("ondas de aproximação — partes e filas", () => {
  it("divide as linhas por onda na ordem do cadastro; o resto vai para Sem área", () => {
    const lines = [
      { id: "l1", location: loc(D, "A", 3) },
      { id: "l2", location: loc(C, "B", 2) },
      { id: "l3", location: loc("est-z", "A", 1) },
      { id: "l4", location: loc(E, "A", 9) },
    ];
    const parts = planWaveParts(lines, [onda2, onda1]);
    assert.deepEqual(
      parts.map((p) => [p.name, p.sortOrder, p.approachWaveId, p.lines.map((l) => l.id)]),
      [
        ["Onda 1", 0, "w1", ["l2", "l4"]],
        ["Onda 2", 1, "w2", ["l1"]],
        ["Sem área", 2, null, ["l3"]],
      ],
    );
  });

  it("sem linhas fora de área não cria a parte Sem área", () => {
    const parts = planWaveParts([{ location: loc(C, "B", 1) }], [onda1]);
    assert.deepEqual(parts.map((p) => p.name), ["Onda 1"]);
  });

  it("ordena pela sequência; fora da onda vai para o fim", () => {
    const items = [loc(E, "A", 2), loc("est-z", "A", 1), loc(C, "B", 3), loc(E, "A", 12), loc(C, "B", 1)];
    const sorted = sortBySequence(items, onda1, (l) => l);
    assert.deepEqual(
      sorted.map((l) => `${code(l.estanteId)}${l.row}`),
      ["C1-1", "C3-1", "E12-1", "E2-1", "Z1-1"],
    );
  });

  it("área do pedido no packing: mais unidades; empate fica com a primeira do cadastro", () => {
    const waves = [onda1, onda2];
    assert.equal(
      packingZoneFor([{ quantity: 1, location: loc(C, "B", 1) }, { quantity: 3, location: loc(D, "A", 2) }], waves),
      "w2",
    );
    assert.equal(
      packingZoneFor([{ quantity: 2, location: loc(C, "B", 1) }, { quantity: 2, location: loc(D, "A", 2) }], waves),
      "w1",
    );
    assert.equal(
      packingZoneFor([{ quantity: 2, location: loc("est-z", "A", 1) }, { quantity: 1, location: null }], waves),
      null,
    );
  });

  it("fila filtrada: urgência primeiro, depois a sequência", () => {
    const items = [
      { id: "a", u: 50, k: 3 },
      { id: "b", u: 80, k: 9 },
      { id: "c", u: 50, k: 1 },
      { id: "d", u: 50, k: null },
    ];
    const sorted = sortByUrgencyThenSequence(items, (i) => i.u, (i) => i.k);
    assert.deepEqual(sorted.map((i) => i.id), ["b", "c", "a", "d"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**
  - Run: `cd apps/api && node --import tsx --test src/services/approach-waves/approach-waves.test.ts`
  - Expected: FAIL com "Cannot find module './matching.js'".

- [ ] **Step 3: Implementar `matching.ts`.**

```ts
import { colunaFromRow } from "../location-route.js";

export type Face = "A" | "B";

export type ApproachStop = {
  estanteId: string;
  face: Face;
  colunaFrom: number | null;
  colunaTo: number | null;
};

export type ApproachWaveDef = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  stops: ApproachStop[];
};

export type ZoneLocation = { estanteId?: string | null; face?: string | null; row: string };

export type ZoneMatch = { waveId: string; stopIndex: number; colunaRank: number };

const STOP_WEIGHT = 100_000;

function faceOf(face: string | null | undefined): Face {
  return String(face ?? "A").trim().toUpperCase() === "B" ? "B" : "A";
}

function stopBounds(stop: ApproachStop): { min: number; max: number } | null {
  if (stop.colunaFrom == null && stop.colunaTo == null) return null;
  const a = stop.colunaFrom ?? stop.colunaTo!;
  const b = stop.colunaTo ?? stop.colunaFrom!;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Posição da coluna dentro da parada, no sentido de → até; null = fora da parada. */
export function colunaRankInStop(stop: ApproachStop, loc: ZoneLocation): number | null {
  if (!loc.estanteId || loc.estanteId !== stop.estanteId || faceOf(loc.face) !== stop.face) return null;
  const n = Number.parseInt(colunaFromRow(loc.row), 10);
  const bounds = stopBounds(stop);
  if (!bounds) return Number.isNaN(n) ? STOP_WEIGHT - 1 : n;
  if (Number.isNaN(n) || n < bounds.min || n > bounds.max) return null;
  const descending = stop.colunaFrom != null && stop.colunaTo != null && stop.colunaFrom > stop.colunaTo;
  return descending ? bounds.max - n : n - bounds.min;
}

/** Primeira onda (pela ordem do cadastro) e parada que contêm a localização. */
export function matchLocation(waves: ApproachWaveDef[], loc: ZoneLocation): ZoneMatch | null {
  const ordered = [...waves].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const wave of ordered) {
    for (let i = 0; i < wave.stops.length; i++) {
      const rank = colunaRankInStop(wave.stops[i]!, loc);
      if (rank != null) return { waveId: wave.id, stopIndex: i, colunaRank: rank };
    }
  }
  return null;
}

export function sequenceKey(match: ZoneMatch): number {
  return match.stopIndex * STOP_WEIGHT + match.colunaRank;
}

export function sequenceKeyIn(wave: ApproachWaveDef, loc: ZoneLocation): number | null {
  const match = matchLocation([wave], loc);
  return match ? sequenceKey(match) : null;
}

export function stopsOverlap(a: ApproachStop, b: ApproachStop): boolean {
  if (a.estanteId !== b.estanteId || a.face !== b.face) return false;
  const ra = stopBounds(a);
  const rb = stopBounds(b);
  if (!ra || !rb) return true;
  return ra.min <= rb.max && rb.min <= ra.max;
}

export function formatStop(stop: ApproachStop, code: (estanteId: string) => string): string {
  const side = stop.face === "A" ? "LD" : "LE";
  if (stop.colunaFrom == null && stop.colunaTo == null) return `${code(stop.estanteId)} ${side}`;
  return `${code(stop.estanteId)} ${side} ${stop.colunaFrom ?? stop.colunaTo}→${stop.colunaTo ?? stop.colunaFrom}`;
}

/** Mensagens para cada par de paradas que atendem as mesmas colunas (em ondas do mesmo tipo). */
export function findStopOverlaps(waves: ApproachWaveDef[], code: (estanteId: string) => string): string[] {
  const all = waves.flatMap((wave) => wave.stops.map((stop) => ({ wave, stop })));
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (!stopsOverlap(a.stop, b.stop)) continue;
      out.push(
        a.wave === b.wave
          ? `${formatStop(a.stop, code)} aparece duas vezes em "${a.wave.name}"`
          : `${formatStop(a.stop, code)} está em "${a.wave.name}" e em "${b.wave.name}"`,
      );
    }
  }
  return out;
}
```

- [ ] **Step 4: Implementar `parts.ts`.**

```ts
import { matchLocation, sequenceKeyIn, type ApproachWaveDef, type ZoneLocation } from "./matching.js";

/** Valor do filtro do packing para pedidos e linhas fora de todas as áreas. */
export const NO_ZONE = "none";

export type PartPlan<T> = {
  approachWaveId: string | null;
  name: string;
  color: string | null;
  sortOrder: number;
  lines: T[];
};

function byCadastro(waves: ApproachWaveDef[]): ApproachWaveDef[] {
  return [...waves].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Agrupa as linhas por onda de aproximação, na ordem do cadastro; fora de área vira "Sem área", no fim. */
export function planWaveParts<T extends { location: ZoneLocation }>(lines: T[], waves: ApproachWaveDef[]): PartPlan<T>[] {
  const byWave = new Map<string, T[]>();
  const none: T[] = [];
  for (const line of lines) {
    const match = matchLocation(waves, line.location);
    if (!match) {
      none.push(line);
      continue;
    }
    const list = byWave.get(match.waveId) ?? [];
    list.push(line);
    byWave.set(match.waveId, list);
  }
  const parts: PartPlan<T>[] = byCadastro(waves)
    .filter((w) => byWave.has(w.id))
    .map((w, i) => ({ approachWaveId: w.id, name: w.name, color: w.color, sortOrder: i, lines: byWave.get(w.id)! }));
  if (none.length > 0) {
    parts.push({ approachWaveId: null, name: "Sem área", color: null, sortOrder: parts.length, lines: none });
  }
  return parts;
}

/** Ordena pela sequência da onda (parada, depois coluna); o que está fora da onda vai para o fim, na ordem original. */
export function sortBySequence<T>(items: T[], wave: ApproachWaveDef, locate: (item: T) => ZoneLocation | null): T[] {
  return items
    .map((item, i) => {
      const loc = locate(item);
      return { item, i, key: (loc ? sequenceKeyIn(wave, loc) : null) ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.item);
}

/** Onda de packing do pedido: a com mais unidades; empate fica com a primeira do cadastro; null = sem área. */
export function packingZoneFor(
  items: Array<{ quantity: number; location: ZoneLocation | null }>,
  waves: ApproachWaveDef[],
): string | null {
  const totals = new Map<string, number>();
  for (const it of items) {
    if (!it.location || it.quantity <= 0) continue;
    const match = matchLocation(waves, it.location);
    if (match) totals.set(match.waveId, (totals.get(match.waveId) ?? 0) + it.quantity);
  }
  let best: string | null = null;
  let bestQty = 0;
  for (const w of byCadastro(waves)) {
    const qty = totals.get(w.id) ?? 0;
    if (qty > bestQty) {
      best = w.id;
      bestQty = qty;
    }
  }
  return best;
}

/** Fila de uma área do packing: urgência maior primeiro, depois a sequência da área; sem posição vai para o fim. */
export function sortByUrgencyThenSequence<T>(
  items: T[],
  urgency: (item: T) => number,
  key: (item: T) => number | null,
): T[] {
  return items
    .map((item, i) => ({ item, i, u: urgency(item), k: key(item) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => b.u - a.u || a.k - b.k || a.i - b.i)
    .map((x) => x.item);
}
```

- [ ] **Step 5: Rodar e ver passar.**
  - Run: `cd apps/api && node --import tsx --test src/services/approach-waves/approach-waves.test.ts`
  - Expected: todos os testes PASS.

- [ ] **Step 6: Script de testes.** No `apps/api/package.json`, no script `test`, acrescente ` src/services/approach-waves/approach-waves.test.ts` logo depois de `src/services/route-engine/route-engine.test.ts`.
  - Run: `cd apps/api && npm test`
  - Expected: todos PASS (90 anteriores + os novos).

- [ ] **Step 7: Commit (com autorização).**

```bash
git add apps/api/src/services/approach-waves apps/api/package.json
git commit -m "feat(ondas): regras de área, sequência e partes das ondas de aproximação"
```

---

### Task 3: Cadastro na API (store e rotas)

**Files:**
- Create: `apps/api/src/services/approach-waves/store.ts`
- Create: `apps/api/src/routes/approach-waves.ts`
- Modify: `apps/api/src/routes/web.ts:43,125` (import e registro)

**Interfaces:**
- Consumes: `findStopOverlaps`, `ApproachWaveDef` (Task 2); `buildFloorGrid`, `cellIndex`, `isWalkable` (`route-engine/floor-grid.ts`); `loadFloorPlanSpecs` (`route-engine/index.ts`); `gondolaCode` (`warehouse-layout.ts`).
- Produces:
  - `class ApproachWaveError extends Error { statusCode: number }`
  - `parseKind(v: unknown): ApproachWaveKind`
  - `type ApproachWaveInput = { id?: string; name: string; color: string; active?: boolean; startX?: number | null; startY?: number | null; stops: Array<{ estanteId: string; face: "A" | "B"; colunaFrom?: number | null; colunaTo?: number | null }> }`
  - `type ApproachWaveDto = { id: string; barracaoId: string; kind: ApproachWaveKind; name: string; color: string; sortOrder: number; active: boolean; startX: number | null; startY: number | null; stops: Array<{ id: string; position: number; estanteId: string; estanteCode: string; face: "A" | "B"; colunaFrom: number | null; colunaTo: number | null }> }`
  - `listApproachWaves(tenantId, barracaoId, kind): Promise<ApproachWaveDto[]>`
  - `saveApproachWaves(tenantId, barracaoId, kind, input: ApproachWaveInput[]): Promise<ApproachWaveDto[]>`
  - `listTenantApproachWaves(tenantId, kind): Promise<Array<{ id: string; name: string; color: string; barracaoId: string }>>`
  - `loadApproachWaveDefs(tenantId, kind): Promise<ApproachWaveDef[]>` (só ativas, todos os barracões)
  - HTTP:
    - `GET|PUT /api/warehouse/floor-plans/:barracaoId/approach-waves?kind=PICKING|PACKING`: o corpo do PUT é `{ waves: ApproachWaveInput[] }`; resposta `{ waves: ApproachWaveDto[] }`.
    - `GET /api/approach-waves?kind=…`: resposta `{ waves: [...] }`.

- [ ] **Step 1: `store.ts`.**

```ts
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
```

- [ ] **Step 2: Rotas.** Crie `apps/api/src/routes/approach-waves.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Permission } from "@wms/shared";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  ApproachWaveError,
  listApproachWaves,
  listTenantApproachWaves,
  parseKind,
  saveApproachWaves,
  type ApproachWaveInput,
} from "../services/approach-waves/store.js";

type Guard = (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof ApproachWaveError) return reply.status(e.statusCode).send({ error: e.message });
  throw e;
}

export function registerApproachWaveRoutes(app: FastifyInstance, guard: Guard) {
  app.get<{ Params: { barracaoId: string }; Querystring: { kind?: string } }>(
    "/api/warehouse/floor-plans/:barracaoId/approach-waves",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        const kind = parseKind(request.query.kind);
        return { waves: await listApproachWaves(tenantWhere(request).tenantId, request.params.barracaoId, kind) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.put<{ Params: { barracaoId: string }; Querystring: { kind?: string }; Body: { waves?: ApproachWaveInput[] } }>(
    "/api/warehouse/floor-plans/:barracaoId/approach-waves",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        const kind = parseKind(request.query.kind);
        const waves = await saveApproachWaves(
          tenantWhere(request).tenantId,
          request.params.barracaoId,
          kind,
          request.body?.waves ?? [],
        );
        return { waves };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get<{ Querystring: { kind?: string } }>(
    "/api/approach-waves",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        const kind = parseKind(request.query.kind);
        return { waves: await listTenantApproachWaves(tenantWhere(request).tenantId, kind) };
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );
}
```

- [ ] **Step 3: Registrar.** Em `apps/api/src/routes/web.ts`:
  - Logo após `import { registerFloorPlanRoutes } from "./floor-plan.js";`: `import { registerApproachWaveRoutes } from "./approach-waves.js";`.
  - Logo após `registerFloorPlanRoutes(app, guard);`: `registerApproachWaveRoutes(app, guard);`.

- [ ] **Step 4: Typecheck e testes.**
  - Run: `cd apps/api && node_modules/.bin/tsc --noEmit && npm test`
  - Expected: sem erros; testes PASS.

- [ ] **Step 5: Teste rápido da API (dev rodando).**
  - Faça touch em `apps/api/src/routes/approach-waves.ts` e espere o `tsx watch` reiniciar (olhe o terminal 1).
  - No navegador logado em `http://localhost:3000`, rode via CDP `Runtime.evaluate`: `fetch('/api/warehouse/floor-plans/cmupmulfl001esyiqfhgbarbw/approach-waves?kind=PICKING').then(r=>r.json())`. Se o front não fizer proxy de `/api`, use o `apiFetch` da página ou o host da API visto no terminal.
  - Expected: `{ waves: [] }`.

- [ ] **Step 6: Commit (com autorização).**

```bash
git add apps/api/src/services/approach-waves/store.ts apps/api/src/routes/approach-waves.ts apps/api/src/routes/web.ts
git commit -m "feat(ondas): API de cadastro das ondas de aproximação"
```

---

### Task 4: Estratégias `BY_APPROACH` e `SINGLE_WAVE`

**Files:**
- Modify: `apps/api/src/services/pick-wave-partition.ts:15-19,150-168`
- Modify: `apps/api/src/services/wave-settings.ts:58-62,368`
- Modify: `apps/api/src/routes/web.ts:546-550,650-654`
- Test: `apps/api/src/services/pick-wave-partition.test.ts`

**Interfaces:**
- Produces: `WavePartitionStrategy = "SINGLE_ITEM" | "PROXIMITY" | "BY_PRODUCT" | "BY_APPROACH" | "SINGLE_WAVE"`. `partitionOrders(orders, "BY_APPROACH" | "SINGLE_WAVE", …)` devolve `[orders]` e nunca exclui pedidos.

- [ ] **Step 1: Teste que falha.** No fim de `pick-wave-partition.test.ts`:

```ts
describe("pick-wave-partition BY_APPROACH e SINGLE_WAVE", () => {
  it("mantêm todos os pedidos num lote só, mesmo sem vínculo e com partição ligada", () => {
    const near = mockOrder("o1", ["p1"], { corridor: 1, row: 1 });
    const far = mockOrder("o2", ["p2", "p3", "p4", "p5", "p6", "p7"], { corridor: 20, row: 30 });
    for (const strategy of ["BY_APPROACH", "SINGLE_WAVE"] as const) {
      const groups = partitionOrders([near, far], strategy, { ...baseSettings, strategy });
      assert.deepEqual(groups.map((g) => g.map((o) => o.id)), [["o1", "o2"]]);
      assert.deepEqual(getExcludedOrderIds([near, far], groups, strategy), []);
      assert.deepEqual(getExcludedOrderDetails([near, far], groups, strategy), []);
    }
  });
});
```

- [ ] **Step 2: Ver falhar.**
  - Run: `cd apps/api && node --import tsx --test src/services/pick-wave-partition.test.ts`
  - Expected: falha de tipo no `tsx`, ou o grupo vem diferente de `[["o1","o2"]]` (cai no `default: BY_PRODUCT`).

- [ ] **Step 3: Implementar a partição.** Em `pick-wave-partition.ts`:

```ts
export type WavePartitionStrategy =
  | "SINGLE_ITEM"
  | "PROXIMITY"
  | "BY_PRODUCT"
  /** Um lote com todos os pedidos, dividido em partes por onda de aproximação. */
  | "BY_APPROACH"
  /** Um lote com todos os pedidos, um separador (onda personalizada). */
  | "SINGLE_WAVE";
```

Em `partitionOrders`, logo depois de `if (orders.length === 0) return [];`:

```ts
  if (strategy === "BY_APPROACH" || strategy === "SINGLE_WAVE") return [orders];
```

- [ ] **Step 4: Configurações.** Em `wave-settings.ts`:
  - `STRATEGIES` passa a incluir `"BY_APPROACH"` e `"SINGLE_WAVE"`.
  - A descrição da meta `defaultPartitionStrategy` passa a ser `"SINGLE_ITEM, PROXIMITY, BY_PRODUCT, BY_APPROACH ou SINGLE_WAVE"`.

- [ ] **Step 5: Tipos nas rotas.** Em `apps/api/src/routes/web.ts`:
  - Importe `import type { WavePartitionStrategy } from "../services/pick-wave-partition.js";`.
  - Troque os dois casts `as | "SINGLE_ITEM" | "PROXIMITY" | "BY_PRODUCT"` (prévia e release) por `as WavePartitionStrategy`. Mantenha o `| undefined` da prévia.

- [ ] **Step 6: Ver passar.**
  - Run: `cd apps/api && npm test && node_modules/.bin/tsc --noEmit`
  - Expected: PASS e sem erros.

- [ ] **Step 7: Commit (com autorização).**

```bash
git add apps/api/src/services/pick-wave-partition.ts apps/api/src/services/pick-wave-partition.test.ts apps/api/src/services/wave-settings.ts apps/api/src/routes/web.ts
git commit -m "feat(ondas): modos por onda de aproximação e onda única"
```

---

### Task 5: Liberação, anexo e prévia criam partes

**Files:**
- Modify: `apps/api/src/services/pick-wave.ts` (imports; `previewWaveRelease`; `createReleasedWave`; `releasePickWaves`; `addOrdersToWave`; `listReleasedWaves`; `findReleasedWaveById`; `getReleasedWaveById`)

**Interfaces:**
- Consumes: `loadApproachWaveDefs` (Task 3); `planWaveParts`, `sortBySequence`, `PartPlan` (Task 2).
- Produces:
  - `NO_APPROACH_WAVES_MESSAGE`.
  - `listReleasedWaves(...)`: cada onda traz `parts: Array<PickWavePart & { acceptedBy: { id; name } | null; lines: { quantityPicked; quantityTotal }[] }>`.
  - `getReleasedWaveById(...)`: traz `parts: Array<PickWavePart & { acceptedBy: { id; name } | null }>`, e cada linha tem `partId`. Em ondas com partes, as linhas vêm agrupadas por parte e ordenadas pela sequência.
  - A prévia ganha `waves[].parts?: Array<{ name: string; lineCount: number }>`.

- [ ] **Step 1: Imports e helper de partes.** No topo de `pick-wave.ts`, junto dos imports:

```ts
import { loadApproachWaveDefs } from "./approach-waves/store.js";
import { planWaveParts, sortBySequence, type PartPlan } from "./approach-waves/parts.js";
```

Logo depois de `buildWaveLinesFromOrders`, adicione:

```ts
export const NO_APPROACH_WAVES_MESSAGE =
  "Cadastre as ondas de aproximação de picking no Mapa do galpão antes de usar este modo";

/** Estratégias em que o lote não exige SKU em comum nem proximidade entre os pedidos. */
const FREE_FORM_STRATEGIES = new Set(["BY_APPROACH", "SINGLE_WAVE"]);

function waveLineKey(line: { productId: string; pickLocationId: string }) {
  return `${line.productId}:${line.pickLocationId}`;
}

/** Reparte as linhas pelas ondas de aproximação de picking (pela gôndola de cada linha). */
async function planApproachParts(
  tenantId: string,
  lines: WaveLineBuild[],
): Promise<PartPlan<{ line: WaveLineBuild; location: { estanteId: string | null; face: string; row: string } }>[]> {
  const waves = await loadApproachWaveDefs(tenantId, "PICKING");
  if (waves.length === 0) throw new PickWaveError(NO_APPROACH_WAVES_MESSAGE);
  const locations = await prisma.location.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.pickLocationId))] } },
    select: { id: true, estanteId: true, face: true, row: true },
  });
  const byId = new Map(locations.map((l) => [l.id, l]));
  return planWaveParts(
    lines.map((line) => ({ line, location: byId.get(line.pickLocationId) ?? { estanteId: null, face: "A", row: "" } })),
    waves,
  );
}

async function createWaveLines(tx: PrismaTx, waveId: string, lines: WaveLineBuild[], partId: string | null) {
  for (const line of lines) {
    const waveLine = await tx.pickWaveLine.create({
      data: {
        waveId,
        partId,
        productId: line.productId,
        pickLocationId: line.pickLocationId,
        quantityTotal: line.quantityTotal,
      },
    });
    await tx.pickWaveAllocation.createMany({
      data: line.allocations.map((a) => ({
        waveLineId: waveLine.id,
        orderItemId: a.orderItemId,
        quantity: a.quantity,
      })),
    });
  }
}
```

- [ ] **Step 2: `createReleasedWave` com partes.** Substitua o corpo, a partir de `return prisma.$transaction(…)`, por:

```ts
  const partPlans =
    meta?.partitionStrategy === "BY_APPROACH" ? await planApproachParts(tenantId, lineBuilds) : null;

  return prisma.$transaction(async (tx) => {
    const w = await tx.pickWave.create({
      data: {
        tenantId,
        name: waveLabel,
        status: PickWaveStatus.RELEASED,
        marketplace: meta?.marketplace ?? null,
        partitionStrategy: meta?.partitionStrategy ?? null,
        releasedAt: new Date(),
        releasedById,
        orders: {
          create: orders.map((o) => ({ orderId: o.id })),
        },
      },
    });

    if (partPlans) {
      for (const plan of partPlans) {
        const part = await tx.pickWavePart.create({
          data: {
            waveId: w.id,
            approachWaveId: plan.approachWaveId,
            name: plan.name,
            color: plan.color,
            sortOrder: plan.sortOrder,
          },
        });
        await createWaveLines(tx, w.id, plan.lines.map((x) => x.line), part.id);
      }
    } else {
      await createWaveLines(tx, w.id, lineBuilds, null);
    }

    return { wave: w, lineCount: lineBuilds.length };
  });
```

- [ ] **Step 3: Falhar cedo sem cadastro.** Em `releasePickWaves` e em `previewWaveRelease`, logo depois de calcular `strategy`:

```ts
  if (strategy === "BY_APPROACH" && (await loadApproachWaveDefs(tenantId, "PICKING")).length === 0) {
    throw new PickWaveError(NO_APPROACH_WAVES_MESSAGE);
  }
```

(Na prévia, o `PickWaveError` já vira `{ error }` na rota `/api/waves/preview`.)

- [ ] **Step 4: Partes na prévia.** Em `previewWaveRelease`, dentro de `groups.map(async (group, index) => { … })`, logo após `const lines = await buildWaveLinesFromOrders(group, tenantId);`:

```ts
      const parts =
        strategy === "BY_APPROACH"
          ? (await planApproachParts(tenantId, lines)).map((p) => ({ name: p.name, lineCount: p.lines.length }))
          : undefined;
```

E inclua `parts,` no objeto retornado (depois de `gondolaPasses`).

- [ ] **Step 5: Anexar pedidos.** Em `addOrdersToWave`:
  - Troque `if (existingInWave.length > 0) {` por `if (existingInWave.length > 0 && !FREE_FORM_STRATEGIES.has(wave.partitionStrategy ?? "")) {`.
  - Logo após o `if (lineBuilds.length === 0) { … }`, adicione:

```ts
  const partPlans = wave.partitionStrategy === "BY_APPROACH" ? await planApproachParts(tenantId, lineBuilds) : [];
  const planByLine = new Map(partPlans.flatMap((p) => p.lines.map((x) => [waveLineKey(x.line), p] as const)));
```

  - Dentro de `prisma.$transaction(async (tx) => {`, como primeira coisa:

```ts
    const parts = await tx.pickWavePart.findMany({ where: { waveId } });
    const partIdFor = async (line: WaveLineBuild): Promise<string | null> => {
      const plan = planByLine.get(waveLineKey(line));
      if (!plan) return null;
      let part = parts.find((p) => p.approachWaveId === plan.approachWaveId);
      if (!part) {
        part = await tx.pickWavePart.create({
          data: { waveId, approachWaveId: plan.approachWaveId, name: plan.name, color: plan.color, sortOrder: parts.length },
        });
        parts.push(part);
      }
      return part.id;
    };
```

  - No ramo `else` (linha nova), troque o `tx.pickWaveLine.create({ data: { waveId, productId…` por `data: { waveId, partId: await partIdFor(line), productId: line.productId, pickLocationId: line.pickLocationId, quantityTotal: line.quantityTotal }`.

- [ ] **Step 6: Partes nas leituras.**
  - Em `listReleasedWaves`, dentro de `include`, adicione:

```ts
      parts: {
        orderBy: { sortOrder: "asc" },
        include: {
          acceptedBy: { select: { id: true, name: true } },
          lines: { select: { quantityPicked: true, quantityTotal: true } },
        },
      },
```

  - Em `findReleasedWaveById`, dentro de `include`, adicione:

```ts
      parts: {
        orderBy: { sortOrder: "asc" },
        include: { acceptedBy: { select: { id: true, name: true } } },
      },
```

- [ ] **Step 7: Ordenação por parte.** Substitua `getReleasedWaveById` por:

```ts
export async function getReleasedWaveById(tenantId: string, waveId: string) {
  const [wave, engine] = await Promise.all([
    findReleasedWaveById(tenantId, waveId),
    getRouteEngine(tenantId),
  ]);
  if (!wave) return wave;
  type Line = (typeof wave.lines)[number];
  const byRoute = (lines: Line[]): Line[] =>
    engine.kind === "PHYSICAL"
      ? engine.sortByRoute(lines.map((line) => ({ ...line.pickLocation, __line: line }))).map((l) => l.__line)
      : lines;
  if (wave.parts.length === 0) return { ...wave, lines: byRoute(wave.lines) };

  const defs = new Map((await loadApproachWaveDefs(tenantId, "PICKING")).map((d) => [d.id, d]));
  const lines = wave.parts.flatMap((part) => {
    const own = wave.lines.filter((l) => l.partId === part.id);
    const def = part.approachWaveId ? defs.get(part.approachWaveId) : undefined;
    return def ? sortBySequence(own, def, (l) => l.pickLocation) : byRoute(own);
  });
  lines.push(...wave.lines.filter((l) => !l.partId));
  return { ...wave, lines };
}
```

- [ ] **Step 8: Typecheck e testes.**
  - Run: `cd apps/api && node_modules/.bin/tsc --noEmit && npm test`
  - Expected: sem erros; PASS.

- [ ] **Step 9: Commit (com autorização).**

```bash
git add apps/api/src/services/pick-wave.ts
git commit -m "feat(ondas): lote por onda de aproximação dividido em partes"
```

---

### Task 6: Aceite e operador por parte (API + rotas do celular)

**Files:**
- Modify: `apps/api/src/services/pick-wave.ts` (`acceptPickWave`, novas `acceptPickWavePart` e `releasePickWavePartAccept`, `assertWaveOperatorForMutation`)
- Modify: `apps/api/src/services/pick-wave-pick.ts:44`
- Modify: `apps/api/src/services/pick-wave-sort.ts:91-93`
- Modify: `apps/api/src/routes/mobile.ts` (imports; `mapWaveMobilePayload`; `/mobile/waves/released`; `/mobile/waves/current`; `/current/accept`; `/:waveId`; `/:waveId/accept`; `/:waveId/release`; `/current/release`)

**Interfaces:**
- Consumes: `getReleasedWaveById` com `parts` e `lines[].partId` (Task 5).
- Produces:
  - `acceptPickWavePart(partId, userId): Promise<{ waveId: string; partId: string; acceptedAt: string }>`
  - `releasePickWavePartAccept(partId, userId): Promise<{ released: boolean }>`
  - `assertWaveOperatorForMutation(waveId, userId, partId?: string | null)`
  - O payload do celular ganha `wave.part: { id; name; color } | null` e as linhas da parte.
  - Na lista `/mobile/waves/released`, cada onda traz `parts: Array<{ id; name; color; lineCount; pendingCount; acceptedById; acceptedByName }>`.
  - As rotas `/mobile/waves/:waveId`, `/accept` e `/release` aceitam `?partId=`.

- [ ] **Step 1: Serviço.** Em `pick-wave.ts`:

No início de `acceptPickWave`, depois do check de status:

```ts
  if ((await prisma.pickWavePart.count({ where: { waveId } })) > 0) {
    throw new PickWaveError("Esta onda é dividida por área — aceite uma das partes", 409);
  }
```

Logo após `releasePickWaveAccept`, adicione:

```ts
export async function acceptPickWavePart(
  partId: string,
  userId: string,
): Promise<{ waveId: string; partId: string; acceptedAt: string }> {
  const part = await prisma.pickWavePart.findUnique({ where: { id: partId }, include: { wave: true } });
  if (!part) throw new PickWaveError("Parte da onda não encontrada", 404);
  if (part.wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está disponível para aceite");
  }
  if (part.acceptedById === userId) {
    return { waveId: part.waveId, partId, acceptedAt: part.acceptedAt!.toISOString() };
  }
  const acceptedAt = new Date();
  const updated = await prisma.pickWavePart.updateMany({
    where: { id: partId, acceptedById: null },
    data: { acceptedById: userId, acceptedAt },
  });
  if (updated.count === 0) {
    throw new PickWaveError("Esta parte já foi aceita por outro operador", 409);
  }
  return { waveId: part.waveId, partId, acceptedAt: acceptedAt.toISOString() };
}

export async function releasePickWavePartAccept(partId: string, userId: string): Promise<{ released: boolean }> {
  const part = await prisma.pickWavePart.findUnique({
    where: { id: partId },
    include: { wave: true, lines: { select: { quantityPicked: true } } },
  });
  if (!part) throw new PickWaveError("Parte da onda não encontrada", 404);
  if (part.wave.status !== PickWaveStatus.RELEASED) throw new PickWaveError("Onda não está disponível", 409);
  if (!part.acceptedById) throw new PickWaveError("Parte não foi aceita", 409);
  if (part.acceptedById !== userId) throw new PickWaveError("Esta parte foi aceita por outro operador", 403);
  if (part.lines.some((l) => l.quantityPicked > 0)) {
    throw new PickWaveError("Separação já iniciada — não é possível cancelar o aceite", 409);
  }
  await prisma.pickWavePart.update({ where: { id: partId }, data: { acceptedById: null, acceptedAt: null } });
  return { released: true };
}
```

Troque `assertWaveOperatorForMutation` por:

```ts
export async function assertWaveOperatorForMutation(
  waveId: string,
  userId: string,
  partId?: string | null,
): Promise<void> {
  const wave = await prisma.pickWave.findUnique({ where: { id: waveId } });
  if (!wave) throw new PickWaveError("Onda não encontrada", 404);
  if (wave.status !== PickWaveStatus.RELEASED) {
    throw new PickWaveError("Onda não está ativa");
  }
  if (partId) {
    const part = await prisma.pickWavePart.findUnique({ where: { id: partId } });
    if (!part) throw new PickWaveError("Parte da onda não encontrada", 404);
    if (!part.acceptedById) throw new PickWaveError("Aceite a parte da onda antes de registrar separação");
    if (part.acceptedById !== userId) {
      throw new PickWaveError("Esta parte está sendo executada por outro operador", 403);
    }
    return;
  }
  if (!wave.acceptedById) {
    throw new PickWaveError(
      "Aceite a onda antes de registrar separação ou packing",
    );
  }
  if (wave.acceptedById !== userId) {
    throw new PickWaveError(
      "Esta onda está sendo executada por outro operador",
      403,
    );
  }
}
```

- [ ] **Step 2: Coleta e triagem.**
  - `pick-wave-pick.ts:44`: `await assertWaveOperatorForMutation(line.waveId, input.userId, line.partId);`
  - `pick-wave-sort.ts:92`: `await assertWaveOperatorForMutation(line.waveId, input.userId, line.partId);`

- [ ] **Step 3: Rotas do celular, escolha da parte e payload.** Em `apps/api/src/routes/mobile.ts`:
  - Importe `acceptPickWavePart` e `releasePickWavePartAccept` junto de `acceptPickWave`.
  - Substitua `mapWaveMobilePayload` por:

```ts
  type ReleasedWave = NonNullable<Awaited<ReturnType<typeof getReleasedWaveById>>>;

  /** Parte pedida; senão a minha com pendência, senão a primeira livre com pendência, senão a primeira. */
  function pickWavePart(wave: ReleasedWave, userId: string, partId?: string) {
    if (wave.parts.length === 0) return null;
    if (partId) {
      const part = wave.parts.find((p) => p.id === partId);
      if (!part) throw new PickWaveError("Parte da onda não encontrada", 404);
      return part;
    }
    const pending = (p: ReleasedWave["parts"][number]) =>
      wave.lines.some((l) => l.partId === p.id && l.quantityPicked < l.quantityTotal);
    return (
      wave.parts.find((p) => p.acceptedById === userId && pending(p)) ??
      wave.parts.find((p) => !p.acceptedById && pending(p)) ??
      wave.parts[0]!
    );
  }

  function mapWaveMobilePayload(
    wave: ReleasedWave,
    userId: string,
    part: ReturnType<typeof pickWavePart>,
  ) {
    const owner = part
      ? { id: part.acceptedById, name: part.acceptedBy?.name ?? null, at: part.acceptedAt }
      : { id: wave.acceptedById, name: wave.acceptedBy?.name ?? null, at: wave.acceptedAt };
    const lines = part ? wave.lines.filter((l) => l.partId === part.id) : wave.lines;
    const canWork = !owner.id || owner.id === userId;
    const waveOrders = wave.orders.map((wo) => wo.order);
    let collectionDeadline: Date | null = null;
    for (const o of waveOrders) {
      if (o.collectionDeadline) {
        if (
          !collectionDeadline ||
          o.collectionDeadline.getTime() < collectionDeadline.getTime()
        ) {
          collectionDeadline = o.collectionDeadline;
        }
      }
    }
    const marketplaces = [
      ...new Set(
        waveOrders.map((o) => formatMarketplace(o.marketplace)).filter((m) => m !== "—"),
      ),
    ];
    return {
      wave: {
        id: wave.id,
        name: wave.name,
        status: wave.status,
        releasedAt: wave.releasedAt,
        orderCount: wave.orders.length,
        gondolaPasses: lines.length,
        marketplaces,
        acceptedById: owner.id,
        acceptedByName: owner.name,
        acceptedAt: owner.at,
        canAccept: !owner.id,
        canWork,
        isMine: owner.id === userId,
        collectionDeadline: collectionDeadline?.toISOString() ?? null,
        part: part ? { id: part.id, name: part.name, color: part.color } : null,
      },
      lines: canWork ? lines.map(mapWaveLineSummary) : [],
    };
  }
```

- [ ] **Step 4: Rotas do celular, lista e handlers.**
  - Em `/mobile/waves/released`, no objeto de cada resumo, adicione:

```ts
        parts: w.parts.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          lineCount: p.lines.length,
          pendingCount: p.lines.filter((l) => l.quantityPicked < l.quantityTotal).length,
          acceptedById: p.acceptedById,
          acceptedByName: p.acceptedBy?.name ?? null,
        })),
```

  - Nos handlers, envolva em `try { … } catch (e) { if (e instanceof PickWaveError) return reply.status(e.statusCode).send({ error: e.message }); throw e; }` quando ainda não houver esse bloco:
    - `/mobile/waves/current`: `return mapWaveMobilePayload(wave, userId, pickWavePart(wave, userId));`
    - `/mobile/waves/current/accept`:

      ```ts
      const part = pickWavePart(wave, userId);
      return part ? await acceptPickWavePart(part.id, userId) : await acceptPickWave(wave.id, userId);
      ```

    - `/mobile/waves/current/release`: `const part = pickWavePart(wave, userId); return part ? await releasePickWavePartAccept(part.id, userId) : await releasePickWaveAccept(wave.id, userId);`
    - `/mobile/waves/:waveId`: tipo `Querystring: { partId?: string }`; `return mapWaveMobilePayload(wave, userId, pickWavePart(wave, userId, request.query.partId));`
    - `/mobile/waves/:waveId/accept`: tipo `Querystring: { partId?: string }`. Carregue antes `const wave = await getReleasedWaveById(tenantId, request.params.waveId); if (!wave) return reply.status(404).send({ error: "Onda não encontrada" });`. Depois:

      ```ts
      const part = pickWavePart(wave, userId, request.query.partId);
      return part ? await acceptPickWavePart(part.id, userId) : await acceptPickWave(wave.id, userId);
      ```

    - `/mobile/waves/:waveId/release`: tipo `Querystring: { partId?: string }`; `const part = pickWavePart(wave, userId, request.query.partId); return part ? await releasePickWavePartAccept(part.id, userId) : await releasePickWaveAccept(wave.id, userId);`

- [ ] **Step 5: Typecheck e testes.**
  - Run: `cd apps/api && node_modules/.bin/tsc --noEmit && npm test`
  - Expected: sem erros; PASS.

- [ ] **Step 6: Commit (com autorização).**

```bash
git add apps/api/src/services/pick-wave.ts apps/api/src/services/pick-wave-pick.ts apps/api/src/services/pick-wave-sort.ts apps/api/src/routes/mobile.ts
git commit -m "feat(ondas): aceite e separação por parte da onda"
```

---

### Task 7: Celular mostra e aceita partes

**Files:**
- Modify: `apps/mobile/lib/api.ts:605-685` (tipos e chamadas de onda)
- Modify: `apps/mobile/hooks/useWavePicking.ts`
- Modify: `apps/mobile/app/wave-picking/index.tsx`
- Modify: `apps/mobile/components/WavePickingPanel.tsx`

**Interfaces:**
- Consumes: o payload e as rotas da Task 6.
- Produces: `WavePartSummary`; `api.getWaveById(waveId, partId?)`, `api.acceptWave(waveId, partId?)`, `api.releaseWaveAccept(waveId, partId?)`; `useWaveById(waveId, partId?)`, `useAcceptWave(waveId?, partId?)`, `useReleaseWaveAccept(waveId?, partId?)`.

- [ ] **Step 1: `lib/api.ts`.**
  - Perto de `WaveLineSummary`, adicione:

```ts
export interface WavePartSummary {
  id: string;
  name: string;
  color: string | null;
  lineCount: number;
  pendingCount: number;
  acceptedById: string | null;
  acceptedByName: string | null;
}

export interface WavePartRef {
  id: string;
  name: string;
  color: string | null;
}

function partQuery(partId?: string | null) {
  return partId ? `?partId=${encodeURIComponent(partId)}` : "";
}
```

  - Em `listReleasedWaves`, no item: `parts: WavePartSummary[];`.
  - Em `getWaveById` e `getCurrentWave`, no `wave`: `part: WavePartRef | null;`.
  - Assinaturas:
    - `getWaveById: (waveId: string, partId?: string | null) => request<…>(\`/mobile/waves/${waveId}${partQuery(partId)}\`)`
    - `acceptWave: (waveId: string, partId?: string | null) => request<{ waveId: string; acceptedAt: string }>(\`/mobile/waves/${waveId}/accept${partQuery(partId)}\`, { method: "POST" })`
    - `releaseWaveAccept: (waveId: string, partId?: string | null) => request<{ released: boolean }>(\`/mobile/waves/${waveId}/release${partQuery(partId)}\`, { method: "POST" })`

- [ ] **Step 2: hooks.** Em `hooks/useWavePicking.ts`:

```ts
export function useWaveById(waveId: string | null, partId?: string | null) {
  return useQuery({
    queryKey: ["wave", waveId, partId ?? null],
    queryFn: () => api.getWaveById(waveId!, partId),
    enabled: !!waveId,
    retry: false,
  });
}

export function useAcceptWave(waveId?: string | null, partId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (waveId ? api.acceptWave(waveId, partId) : api.acceptCurrentWave()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}

export function useReleaseWaveAccept(waveId?: string | null, partId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      waveId ? api.releaseWaveAccept(waveId, partId) : api.releaseCurrentWaveAccept(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wave"] });
    },
  });
}
```

- [ ] **Step 3: Lista com partes.** Em `app/wave-picking/index.tsx`, troque o estado e a escolha da onda:

```tsx
type WaveEntry = {
  key: string;
  waveId: string;
  partId: string | null;
  title: string;
  color: string | null;
  orderCount: number;
  lineCount: number;
  acceptedByName: string | null;
  collectionDeadline: string | null;
  marketplaces?: string[];
};

export default function WavePickingListScreen() {
  const released = useReleasedWaves();
  const [selected, setSelected] = useState<{ waveId: string; partId: string | null } | null>(null);

  const waves = released.data?.waves ?? [];
  const entries: WaveEntry[] = waves.flatMap((w) =>
    w.parts.length > 0
      ? w.parts.map((p) => ({
          key: `${w.id}:${p.id}`,
          waveId: w.id,
          partId: p.id,
          title: `${w.name} · ${p.name}`,
          color: p.color,
          orderCount: w.orderCount,
          lineCount: p.pendingCount,
          acceptedByName: p.acceptedByName,
          collectionDeadline: w.collectionDeadline,
          marketplaces: w.marketplaces,
        }))
      : [
          {
            key: w.id,
            waveId: w.id,
            partId: null,
            title: w.name,
            color: null,
            orderCount: w.orderCount,
            lineCount: w.lineCount,
            acceptedByName: w.acceptedByName,
            collectionDeadline: w.collectionDeadline,
            marketplaces: w.marketplaces,
          },
        ],
  );
  const active = selected ?? (entries[0] ? { waveId: entries[0].waveId, partId: entries[0].partId } : null);

  const { data, isLoading, error, refetch, isRefetching } = useWaveById(active?.waveId ?? null, active?.partId);
  const acceptWave = useAcceptWave(active?.waveId ?? null, active?.partId);
```

  - No resto do arquivo:
    - `waves.length === 0` → `entries.length === 0`.
    - `waves.length > 1 && !selectedWaveId` → `entries.length > 1 && !selected`.
    - `waves.length > 1 ?` → `entries.length > 1 ?`.
    - Todo `setSelectedWaveId(null)` → `setSelected(null)`.
  - No `FlatList` da escolha: `data={entries}`, `keyExtractor={(e) => e.key}`, `onPress={() => setSelected({ waveId: item.waveId, partId: item.partId })}`, título `{item.title}`, contagem `{item.orderCount} pedidos · {item.lineCount} linhas`. No cartão, borda com a cor da área: `style={[styles.card, item.color ? { borderColor: item.color } : null]}`.
  - Títulos da onda aberta:
    - `{wave.name}` → `{wave.part ? \`${wave.name} · ${wave.part.name}\` : wave.name}` nos três lugares.
    - `"Aceitar esta onda"` → `{wave.part ? "Aceitar esta parte" : "Aceitar esta onda"}`.
    - `Onda aceita por` → `{wave.part ? "Parte aceita por" : "Onda aceita por"}`.
    - `Você está executando esta onda` → `{wave.part ? "Você está executando esta parte" : "Você está executando esta onda"}`.

- [ ] **Step 4: Painel atual.** Em `components/WavePickingPanel.tsx`:
  - `useAcceptWave(data?.wave.id, data?.wave.part?.id)` e `useReleaseWaveAccept(data?.wave.id, data?.wave.part?.id)`.
  - Os três `{wave.name}` → `{wave.part ? \`${wave.name} · ${wave.part.name}\` : wave.name}`.
  - Os textos de aceite seguem a mesma troca do Step 3.

- [ ] **Step 5: Typecheck do celular.**
  - Run: `cd apps/mobile && node_modules/.bin/tsc --noEmit`
  - Expected: sem erros.

- [ ] **Step 6: Commit (com autorização).**

```bash
git add apps/mobile/lib/api.ts apps/mobile/hooks/useWavePicking.ts apps/mobile/app/wave-picking/index.tsx apps/mobile/components/WavePickingPanel.tsx
git commit -m "feat(mobile): separador escolhe e aceita a parte da onda"
```

---

### Task 8: Cadastro no mapa do galpão (web)

**Files:**
- Create: `apps/web/lib/api/approach-waves.ts`
- Create: `apps/web/components/warehouse/floor-plan/approach-geometry.ts`
- Create: `apps/web/components/warehouse/floor-plan/approach-overlay.tsx`
- Create: `apps/web/components/warehouse/floor-plan/approach-waves-panel.tsx`
- Modify: `apps/web/components/warehouse/floor-plan/floor-plan-canvas.tsx`
- Modify: `apps/web/components/warehouse/floor-plan/floor-plan-editor.tsx`

**Interfaces:**
- Consumes: as rotas da Task 3; os helpers de `geometry.ts` (`elementAt`, `faceColunaRange`, `faceColunas`, `faceHalfRect`, `gondolaView`, `isBlocking`, `Face`).
- Produces:
  - `type ApproachWaveKind`, `ApproachStop`, `ApproachWave`, `ApproachWaveSummary`
  - `fetchApproachWaves(barracaoId, kind)`, `saveApproachWaves(barracaoId, kind, waves)`, `fetchTenantApproachWaves(kind)`
  - `stopFromPoint`, `sameStop`, `stopRects`, `stopLabel`, `APPROACH_COLORS`
  - `<ApproachOverlay>`, `<ApproachWavesPanel>`, `type ApproachPick`
  - Props novas do canvas: `overlay?: ReactNode` e `onPointClick?: (x: number, y: number) => void`

- [ ] **Step 1: Cliente.** Crie `apps/web/lib/api/approach-waves.ts`:

```ts
import { apiFetch } from "@/lib/api/client";

export type ApproachWaveKind = "PICKING" | "PACKING";

export interface ApproachStop {
  estanteId: string;
  face: "A" | "B";
  colunaFrom: number | null;
  colunaTo: number | null;
  estanteCode?: string;
}

export interface ApproachWave {
  id?: string;
  name: string;
  color: string;
  active: boolean;
  startX: number | null;
  startY: number | null;
  stops: ApproachStop[];
}

export interface ApproachWaveSummary {
  id: string;
  name: string;
  color: string;
  barracaoId: string;
}

const base = (barracaoId: string, kind: ApproachWaveKind) =>
  `/api/warehouse/floor-plans/${encodeURIComponent(barracaoId)}/approach-waves?kind=${kind}`;

export function fetchApproachWaves(barracaoId: string, kind: ApproachWaveKind) {
  return apiFetch<{ waves: ApproachWave[] }>(base(barracaoId, kind));
}

export function saveApproachWaves(barracaoId: string, kind: ApproachWaveKind, waves: ApproachWave[]) {
  return apiFetch<{ waves: ApproachWave[] }>(base(barracaoId, kind), {
    method: "PUT",
    body: JSON.stringify({ waves }),
  });
}

export function fetchTenantApproachWaves(kind: ApproachWaveKind) {
  return apiFetch<{ waves: ApproachWaveSummary[] }>(`/api/approach-waves?kind=${kind}`);
}
```

- [ ] **Step 2: Geometria pura.** Crie `apps/web/components/warehouse/floor-plan/approach-geometry.ts`:

```ts
import type { ApproachStop } from "@/lib/api/approach-waves";
import type { FloorElement, FloorPlanEstante } from "@/lib/api/floor-plan";
import { elementAt, faceColunaRange, faceColunas, faceHalfRect, gondolaView, type Face } from "./geometry";

export const APPROACH_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

function faceAt(e: FloorElement, px: number, py: number): Face | null {
  for (const face of ["A", "B"] as Face[]) {
    const r = faceHalfRect(e, face);
    if (px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height) return face;
  }
  return null;
}

function faceEstanteId(e: FloorElement, face: Face): string | null {
  return (face === "B" ? e.estanteIdB || e.estanteId : e.estanteId) || null;
}

function stopBounds(stop: ApproachStop): { min: number; max: number } | null {
  if (stop.colunaFrom == null && stop.colunaTo == null) return null;
  const a = stop.colunaFrom ?? stop.colunaTo!;
  const b = stop.colunaTo ?? stop.colunaFrom!;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Parada do lado da gôndola clicado (coordenadas contínuas em células); gôndola sem faixa = estante inteira. */
export function stopFromPoint(
  elements: FloorElement[],
  estantes: Map<string, FloorPlanEstante>,
  px: number,
  py: number,
): ApproachStop | null {
  const e = elementAt(elements, Math.floor(px), Math.floor(py));
  if (!e || e.type !== "GONDOLA") return null;
  const face = faceAt(e, px, py);
  if (!face || (face === "A" ? !e.faceAEnabled : !e.faceBEnabled)) return null;
  const estanteId = faceEstanteId(e, face);
  if (!estanteId) return null;
  const range = faceColunaRange(e, face);
  if (range.min == null && range.max == null) return { estanteId, face, colunaFrom: null, colunaTo: null };
  const nums = faceColunas(gondolaView(e, estantes), face)
    .map((c) => Number.parseInt(c, 10))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return { estanteId, face, colunaFrom: range.min, colunaTo: range.max };
  return { estanteId, face, colunaFrom: Math.min(...nums), colunaTo: Math.max(...nums) };
}

export function sameStop(a: ApproachStop, b: ApproachStop): boolean {
  return a.estanteId === b.estanteId && a.face === b.face && a.colunaFrom === b.colunaFrom && a.colunaTo === b.colunaTo;
}

/** Metades de gôndola que atendem a parada (mesma estante e lado, com alguma coluna dentro da faixa). */
export function stopRects(stop: ApproachStop, elements: FloorElement[], estantes: Map<string, FloorPlanEstante>) {
  const bounds = stopBounds(stop);
  const out: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const e of elements) {
    if (e.type !== "GONDOLA") continue;
    if (stop.face === "A" ? !e.faceAEnabled : !e.faceBEnabled) continue;
    if (faceEstanteId(e, stop.face) !== stop.estanteId) continue;
    if (bounds) {
      const codes = faceColunas(gondolaView(e, estantes), stop.face);
      const hit = codes.some((c) => {
        const n = Number.parseInt(c, 10);
        return !Number.isNaN(n) && n >= bounds.min && n <= bounds.max;
      });
      if (!hit) continue;
    }
    out.push(faceHalfRect(e, stop.face));
  }
  return out;
}

export function stopLabel(stop: ApproachStop, code: (estanteId: string) => string): string {
  const side = stop.face === "A" ? "LD" : "LE";
  if (stop.colunaFrom == null && stop.colunaTo == null) return `${code(stop.estanteId)} ${side} (inteira)`;
  return `${code(stop.estanteId)} ${side} ${stop.colunaFrom ?? stop.colunaTo}→${stop.colunaTo ?? stop.colunaFrom}`;
}
```

- [ ] **Step 3: Overlay.** Crie `apps/web/components/warehouse/floor-plan/approach-overlay.tsx`:

```tsx
"use client";

import type { ApproachWave } from "@/lib/api/approach-waves";
import type { FloorElement, FloorPlanEstante } from "@/lib/api/floor-plan";
import { stopRects } from "./approach-geometry";

export function ApproachOverlay({
  waves,
  selectedIndex,
  elements,
  estantes,
}: {
  waves: ApproachWave[];
  selectedIndex: number | null;
  elements: FloorElement[];
  estantes: Map<string, FloorPlanEstante>;
}) {
  return (
    <g pointerEvents="none">
      {waves.map((w, wi) => {
        const isSelected = wi === selectedIndex;
        if (!w.active && !isSelected) return null;
        const stops = w.stops.map((stop) => stopRects(stop, elements, estantes));
        const path: Array<[number, number]> = [];
        if (w.startX != null && w.startY != null) path.push([w.startX + 0.5, w.startY + 0.5]);
        for (const rects of stops) {
          const r = rects[0];
          if (r) path.push([r.x + r.width / 2, r.y + r.height / 2]);
        }
        return (
          <g key={w.id ?? `new-${wi}`}>
            {stops.flatMap((rects, si) =>
              rects.map((r, ri) => (
                <rect
                  key={`${si}-${ri}`}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  fill={w.color}
                  fillOpacity={isSelected ? 0.55 : 0.28}
                  stroke={w.color}
                  strokeWidth={isSelected ? 0.12 : 0.05}
                />
              )),
            )}
            {isSelected && path.length > 1 ? (
              <polyline
                points={path.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={w.color}
                strokeWidth={0.12}
                strokeDasharray="0.4 0.25"
              />
            ) : null}
            {isSelected
              ? stops.map((rects, si) => {
                  const r = rects[0];
                  if (!r) return null;
                  return (
                    <g key={`n-${si}`}>
                      <circle cx={r.x + r.width / 2} cy={r.y + r.height / 2} r={0.45} fill={w.color} stroke="#fff" strokeWidth={0.06} />
                      <text
                        x={r.x + r.width / 2}
                        y={r.y + r.height / 2}
                        fontSize={0.45}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#fff"
                      >
                        {si + 1}
                      </text>
                    </g>
                  );
                })
              : null}
            {w.startX != null && w.startY != null ? (
              <g>
                <rect x={w.startX} y={w.startY} width={1} height={1} rx={0.25} fill={w.color} stroke="#fff" strokeWidth={0.08} />
                <text
                  x={w.startX + 0.5}
                  y={w.startY + 0.5}
                  fontSize={0.55}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                >
                  S
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
```

- [ ] **Step 4: Painel.** Crie `apps/web/components/warehouse/floor-plan/approach-waves-panel.tsx`:

```tsx
"use client";

import { ArrowDown, ArrowUp, Flag, MapPin, Plus, Repeat, Trash2, X } from "lucide-react";
import type { ApproachStop, ApproachWave, ApproachWaveKind } from "@/lib/api/approach-waves";
import { APPROACH_COLORS, stopLabel } from "./approach-geometry";

export type ApproachPick = "start" | "stops" | null;

const KINDS: Array<{ id: ApproachWaveKind; label: string }> = [
  { id: "PICKING", label: "Picking" },
  { id: "PACKING", label: "Packing" },
];

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function colunaInput(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function ApproachWavesPanel({
  kind,
  onKindChange,
  waves,
  selectedIndex,
  onSelect,
  onChange,
  pick,
  onPickChange,
  estanteCode,
  dirty,
  saving,
  error,
  planDirty,
  onSave,
  onDiscard,
}: {
  kind: ApproachWaveKind;
  onKindChange: (kind: ApproachWaveKind) => void;
  waves: ApproachWave[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onChange: (waves: ApproachWave[]) => void;
  pick: ApproachPick;
  onPickChange: (pick: ApproachPick) => void;
  estanteCode: (estanteId: string) => string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  planDirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const selected = selectedIndex != null ? waves[selectedIndex] : undefined;
  const update = (patch: Partial<ApproachWave>) => {
    if (selectedIndex == null) return;
    onChange(waves.map((w, i) => (i === selectedIndex ? { ...w, ...patch } : w)));
  };
  const setStops = (stops: ApproachStop[]) => update({ stops });

  const addWave = () => {
    const color = APPROACH_COLORS[waves.length % APPROACH_COLORS.length]!;
    onChange([...waves, { name: `Onda ${waves.length + 1}`, color, active: true, startX: null, startY: null, stops: [] }]);
    onSelect(waves.length);
    onPickChange("start");
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => onKindChange(k.id)}
            className={`flex-1 rounded-md px-2 py-1 font-medium ${kind === k.id ? "bg-white text-[#0d9488] shadow-sm" : "text-slate-600"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {kind === "PICKING"
          ? "Cada onda vira uma parte do lote: um separador por área, andando na ordem das paradas."
          : "Cada mesa de packing pega a fila da sua onda, na ordem das paradas."}
      </p>
      {planDirty ? (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Salve a planta antes, para a saída valer no desenho novo.</p>
      ) : null}

      <ul className="space-y-1">
        {waves.map((w, i) => (
          <li key={w.id ?? `new-${i}`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onSelect(i);
                onPickChange(null);
              }}
              className={`flex flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-left ${i === selectedIndex ? "border-[#0d9488] bg-teal-50" : "bg-white"}`}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: w.color }} />
              <span className={`flex-1 truncate font-medium ${w.active ? "" : "text-slate-400 line-through"}`}>{w.name}</span>
              <span className="text-xs text-slate-500">{w.stops.length} parada(s)</span>
            </button>
            <button type="button" title="Subir" onClick={() => { onChange(move(waves, i, i - 1)); onSelect(Math.max(0, i - 1)); }} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Descer" onClick={() => { onChange(move(waves, i, i + 1)); onSelect(Math.min(waves.length - 1, i + 1)); }} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={addWave} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-1.5 text-slate-600 hover:bg-slate-50">
        <Plus className="h-4 w-4" /> Nova onda
      </button>

      {selected ? (
        <div className="space-y-3 rounded-lg border p-3">
          <input
            value={selected.name}
            onChange={(e) => update({ name: e.target.value })}
            className="w-full rounded-md border px-2 py-1 font-medium"
            maxLength={60}
          />
          <div className="flex flex-wrap gap-1.5">
            {APPROACH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => update({ color: c })}
                className={`h-5 w-5 rounded-full ${selected.color === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selected.active} onChange={(e) => update({ active: e.target.checked })} /> Ativa
          </label>

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onPickChange(pick === "start" ? null : "start")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs ${pick === "start" ? "border-[#0d9488] bg-teal-50 text-[#0d9488]" : ""}`}
            >
              <Flag className="h-3.5 w-3.5" /> {selected.startX != null ? "Mudar saída" : "Marcar saída"}
            </button>
            <button
              type="button"
              onClick={() => onPickChange(pick === "stops" ? null : "stops")}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs ${pick === "stops" ? "border-[#0d9488] bg-teal-50 text-[#0d9488]" : ""}`}
            >
              <MapPin className="h-3.5 w-3.5" /> Adicionar paradas
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {pick === "start"
              ? "Clique numa célula livre do mapa para a saída."
              : pick === "stops"
                ? "Clique no lado de uma gôndola (ou parte) para adicionar a próxima parada."
                : selected.startX != null
                  ? `Saída na célula (${selected.startX}, ${selected.startY}).`
                  : "Sem saída marcada."}
          </p>

          <ol className="space-y-1">
            {selected.stops.map((stop, si) => (
              <li key={`${stop.estanteId}-${stop.face}-${si}`} className="flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-1">
                <span className="w-5 text-center text-xs font-bold" style={{ color: selected.color }}>{si + 1}</span>
                <span className="flex-1 truncate text-xs font-medium">{stopLabel(stop, estanteCode)}</span>
                <input
                  type="number"
                  min={1}
                  title="De (coluna)"
                  value={stop.colunaFrom ?? ""}
                  onChange={(e) => setStops(selected.stops.map((s, k) => (k === si ? { ...s, colunaFrom: colunaInput(e.target.value) } : s)))}
                  className="w-12 rounded border px-1 py-0.5 text-xs"
                />
                <input
                  type="number"
                  min={1}
                  title="Até (coluna)"
                  value={stop.colunaTo ?? ""}
                  onChange={(e) => setStops(selected.stops.map((s, k) => (k === si ? { ...s, colunaTo: colunaInput(e.target.value) } : s)))}
                  className="w-12 rounded border px-1 py-0.5 text-xs"
                />
                <button type="button" title="Inverter sentido" onClick={() => setStops(selected.stops.map((s, k) => (k === si ? { ...s, colunaFrom: s.colunaTo, colunaTo: s.colunaFrom } : s)))} className="rounded p-0.5 text-slate-500 hover:bg-white">
                  <Repeat className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="Subir" onClick={() => setStops(move(selected.stops, si, si - 1))} className="rounded p-0.5 text-slate-500 hover:bg-white">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="Descer" onClick={() => setStops(move(selected.stops, si, si + 1))} className="rounded p-0.5 text-slate-500 hover:bg-white">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="Remover" onClick={() => setStops(selected.stops.filter((_, k) => k !== si))} className="rounded p-0.5 text-red-500 hover:bg-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Excluir "${selected.name}"?`)) return;
              onChange(waves.filter((_, i) => i !== selectedIndex));
              onSelect(null);
              onPickChange(null);
            }}
            className="flex items-center gap-1 text-xs text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir onda
          </button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        {dirty ? (
          <button type="button" onClick={onDiscard} className="rounded-lg border px-3 py-1.5">
            Descartar
          </button>
        ) : null}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="flex-1 rounded-lg bg-[#0d9488] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar ondas"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Canvas.** Em `floor-plan-canvas.tsx`:
  - Import: `import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";`.
  - Props: adicione `overlay?: ReactNode;` e `onPointClick?: (x: number, y: number) => void;`, na desestruturação e no tipo.
  - Troque `cellAt` por:

```ts
  const pointAt = (ev: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const cellAt = (ev: { clientX: number; clientY: number }) => {
    const p = pointAt(ev);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };
```

  - No início de `onPointerDown`:

```ts
    if (onPointClick && ev.button === 0) {
      const p = pointAt(ev);
      if (p.x >= 0 && p.y >= 0 && p.x < widthCells && p.y < heightCells) onPointClick(p.x, p.y);
      return;
    }
```

  - Cursor: `cursor: onPointClick ? "pointer" : interactive && tool !== "select" ? "crosshair" : "default",`.
  - Logo antes de `{route ? <RouteOverlay route={route} /> : null}`: `{overlay}`.

- [ ] **Step 6: Editor, estado e handlers.** Em `floor-plan-editor.tsx`:
  - Imports:
    - `fetchApproachWaves, saveApproachWaves, type ApproachWave, type ApproachWaveKind` de `@/lib/api/approach-waves`;
    - `ApproachOverlay` de `./approach-overlay`;
    - `ApproachWavesPanel, type ApproachPick` de `./approach-waves-panel`;
    - `sameStop, stopFromPoint` de `./approach-geometry`;
    - acrescente `elementAt` e `isBlocking` ao import de `./geometry`.
  - Troque `type Mode = "edit" | "route";` por:

```ts
type Mode = "edit" | "route" | "approach";

const MODE_LABELS: Record<Mode, string> = {
  edit: "Editar planta",
  route: "Simular rota",
  approach: "Ondas de aproximação",
};
```

  - Depois dos estados de rota:

```ts
  const [approachKind, setApproachKind] = useState<ApproachWaveKind>("PICKING");
  const [approachWaves, setApproachWaves] = useState<ApproachWave[]>([]);
  const [approachSelected, setApproachSelected] = useState<number | null>(null);
  const [approachPick, setApproachPick] = useState<ApproachPick>(null);
  const [approachDirty, setApproachDirty] = useState(false);
  const [approachSaving, setApproachSaving] = useState(false);
  const [approachError, setApproachError] = useState<string | null>(null);

  const loadApproach = useCallback(
    async (kind: ApproachWaveKind) => {
      setApproachError(null);
      try {
        const { waves } = await fetchApproachWaves(barracaoId, kind);
        setApproachWaves(waves);
        setApproachSelected(waves.length > 0 ? 0 : null);
        setApproachPick(null);
        setApproachDirty(false);
      } catch (e) {
        setApproachError(e instanceof Error ? e.message : "Erro ao carregar ondas de aproximação");
      }
    },
    [barracaoId],
  );

  useEffect(() => {
    if (mode === "approach") void loadApproach(approachKind);
  }, [mode, approachKind, loadApproach]);
```

  - Antes do `useEffect` de teclado:

```ts
  const confirmLeaveApproach = () =>
    !approachDirty || window.confirm("Descartar alterações nas ondas de aproximação?");

  const changeApproach = (waves: ApproachWave[]) => {
    setApproachWaves(waves);
    setApproachDirty(true);
  };

  const onApproachClick = (px: number, py: number) => {
    if (approachSelected == null || !approachPick) return;
    const wave = approachWaves[approachSelected];
    if (!wave) return;
    if (approachPick === "start") {
      const x = Math.floor(px);
      const y = Math.floor(py);
      const hit = elementAt(elements, x, y);
      if (hit && isBlocking(hit)) {
        setApproachError("A saída precisa ficar numa célula livre");
        return;
      }
      setApproachError(null);
      changeApproach(approachWaves.map((w, i) => (i === approachSelected ? { ...w, startX: x, startY: y } : w)));
      setApproachPick("stops");
      return;
    }
    const stop = stopFromPoint(elements, estanteById, px, py);
    if (!stop || wave.stops.some((s) => sameStop(s, stop))) return;
    changeApproach(approachWaves.map((w, i) => (i === approachSelected ? { ...w, stops: [...w.stops, stop] } : w)));
  };

  const saveApproach = async () => {
    setApproachSaving(true);
    setApproachError(null);
    try {
      const { waves } = await saveApproachWaves(barracaoId, approachKind, approachWaves);
      setApproachWaves(waves);
      setApproachDirty(false);
      setApproachPick(null);
    } catch (e) {
      setApproachError(e instanceof Error ? e.message : "Erro ao salvar ondas de aproximação");
    } finally {
      setApproachSaving(false);
    }
  };
```

- [ ] **Step 7: Editor, JSX.**
  - Botões de modo: troque `(["edit", "route"] as Mode[])` por `(["edit", "route", "approach"] as Mode[])`.
    - No `onClick`: `if (mode === "approach" && m2 !== "approach" && !confirmLeaveApproach()) return; setMode(m2); setTool("select");`.
    - Rótulo: `{MODE_LABELS[m2]}`.
  - No `<FloorPlanCanvas …>`, acrescente:

```tsx
                  onPointClick={mode === "approach" ? onApproachClick : undefined}
                  overlay={
                    mode === "approach" ? (
                      <ApproachOverlay
                        waves={approachWaves}
                        selectedIndex={approachSelected}
                        elements={elements}
                        estantes={estanteById}
                      />
                    ) : null
                  }
```

  - Painel da direita: troque o ternário `mode === "edit" ? (…) : (<RoutePanel …/>)` por `mode === "edit" ? (…) : mode === "route" ? (<RoutePanel …/>) : (…)`, onde o último ramo é:

```tsx
                <ApproachWavesPanel
                  kind={approachKind}
                  onKindChange={(k) => {
                    if (k === approachKind || !confirmLeaveApproach()) return;
                    setApproachKind(k);
                  }}
                  waves={approachWaves}
                  selectedIndex={approachSelected}
                  onSelect={setApproachSelected}
                  onChange={changeApproach}
                  pick={approachPick}
                  onPickChange={setApproachPick}
                  estanteCode={(id) => estanteById.get(id)?.code ?? "?"}
                  dirty={approachDirty}
                  saving={approachSaving}
                  error={approachError}
                  planDirty={dirty}
                  onSave={saveApproach}
                  onDiscard={() => void loadApproach(approachKind)}
                />
```

- [ ] **Step 8: Typecheck da web.**
  - Run: `cd apps/web && node_modules/.bin/tsc --noEmit`
  - Expected: sem erros.

- [ ] **Step 9: Verificação no navegador.**
  - Abra `http://localhost:3000/gestao-barracao/mapa?barracaoId=cmupmulfl001esyiqfhgbarbw` e vá em "Ondas de aproximação".
  - Crie "Onda 1": marque a saída e clique em C (LE) parte 1, C (LE) parte 2, D (LD) parte 2, E (LD) parte 2, E (LD) parte 1. Inverta as duas paradas da E. Salve.
  - Esperado: os lados ficam pintados, os números 1 a 5 aparecem e a linha tracejada sai da saída.
  - Recarregue a página: a onda continua igual.
  - Crie "Onda 2" com uma parada já usada na Onda 1 e salve. Esperado: erro "Paradas repetidas: …".
  - Tire screenshot para o usuário.
  - Ao final, apague as ondas de teste (excluir + salvar), a menos que o usuário queira mantê-las.

- [ ] **Step 10: Commit (com autorização).**

```bash
git add apps/web/lib/api/approach-waves.ts apps/web/components/warehouse/floor-plan
git commit -m "feat(mapa): cadastro das ondas de aproximação no mapa do galpão"
```

---

### Task 9: Modos novos na tela de ondas (web)

**Files:**
- Modify: `apps/web/lib/api/waves.ts:16,36-44`
- Modify: `apps/web/app/(dashboard)/ondas/page.tsx:38-45` e as duas prévias (~556 e ~853)
- Modify: `apps/web/app/(dashboard)/ondas/configuracoes/page.tsx:395-397`

**Interfaces:**
- Consumes: as estratégias da Task 4 e `waves[].parts` da prévia (Task 5).

- [ ] **Step 1: Tipos.** Em `lib/api/waves.ts`:
  - `export type WavePartitionStrategy = "SINGLE_ITEM" | "PROXIMITY" | "BY_PRODUCT" | "BY_APPROACH" | "SINGLE_WAVE";`
  - Em `WavePreview.waves`, no item: `parts?: Array<{ name: string; lineCount: number }>;`.

- [ ] **Step 2: Seletor.** Em `ondas/page.tsx`, `PARTITION_STRATEGIES` passa a ser:

```ts
const PARTITION_STRATEGIES: Array<{
  value: WavePartitionStrategy;
  label: string;
}> = [
  { value: "BY_APPROACH", label: "Por onda de aproximação" },
  { value: "SINGLE_WAVE", label: "Onda única (personalizada)" },
  { value: "SINGLE_ITEM", label: "Item único" },
  { value: "PROXIMITY", label: "Proximidade" },
  { value: "BY_PRODUCT", label: "SKU compartilhado" },
];
```

- [ ] **Step 3: Partes nas prévias.** Logo após o `<p>` "pedido(s) → … passagem(ns) na gôndola", nas duas prévias (`preview` e `manualPreview`):

```tsx
              {preview.waves?.some((w) => w.parts?.length) ? (
                <p>
                  Partes:{" "}
                  {preview.waves
                    .flatMap((w) => w.parts ?? [])
                    .map((p) => `${p.name} (${p.lineCount})`)
                    .join(" · ")}
                </p>
              ) : null}
```

(Na prévia manual, use `manualPreview` no lugar de `preview`.)

- [ ] **Step 4: Configurações.** Em `ondas/configuracoes/page.tsx`, dentro do `<select>` do modo padrão, antes de `SINGLE_ITEM`:

```tsx
                <option value="BY_APPROACH">Por onda de aproximação</option>
                <option value="SINGLE_WAVE">Onda única</option>
```

- [ ] **Step 5: Typecheck e navegador.**
  - Run: `cd apps/web && node_modules/.bin/tsc --noEmit`. Expected: sem erros.
  - Com a Onda 1 (Task 8) cadastrada, em `/ondas` → "Montar onda": escolha "Por onda de aproximação", selecione pedidos e clique em pré-visualizar. Esperado: "Partes: Onda 1 (n) · …".
  - Sem cadastro, o esperado é a mensagem "Cadastre as ondas de aproximação…".
  - Não libere ondas reais com pedidos do usuário sem perguntar. Se for testar a liberação, use pedidos de teste e apague tudo depois (ondas, partes, alocações, e o status dos pedidos voltando a PENDING).

- [ ] **Step 6: Commit (com autorização).**

```bash
git add apps/web/lib/api/waves.ts "apps/web/app/(dashboard)/ondas"
git commit -m "feat(ondas): modos por onda de aproximação e onda única na web"
```

---

### Task 10: Packing filtrado por onda de aproximação

**Files:**
- Modify: `apps/api/src/services/order-packing.ts` (imports; `listUnifiedPackingQueue`)
- Modify: `apps/api/src/routes/web.ts:1768-1772`
- Modify: `apps/web/lib/api/operations.ts:750-752`
- Modify: `apps/web/app/(dashboard)/packing/page.tsx`

**Interfaces:**
- Consumes: `loadApproachWaveDefs` (Task 3); `matchLocation`, `sequenceKeyIn`, `ZoneLocation`, `NO_ZONE`, `packingZoneFor`, `sortByUrgencyThenSequence` (Task 2); `fetchTenantApproachWaves` (Task 8).
- Produces:
  - `listUnifiedPackingQueue(tenantId, opts?: { approachWaveId?: string })`
  - `GET /api/packing/queue/unified?approachWaveId=<id|none>`
  - `fetchUnifiedPackingQueue(approachWaveId?: string)`

- [ ] **Step 1: Serviço.** Em `order-packing.ts`:

```ts
import { loadApproachWaveDefs } from "./approach-waves/store.js";
import { matchLocation, sequenceKeyIn, type ZoneLocation } from "./approach-waves/matching.js";
import { NO_ZONE, packingZoneFor, sortByUrgencyThenSequence } from "./approach-waves/parts.js";
```

Antes de `listUnifiedPackingQueue`:

```ts
/** Filtro da fila por onda de aproximação do packing (`none` = fora de todas as áreas). */
async function packingZoneFilter(tenantId: string, approachWaveId: string) {
  const defs = await loadApproachWaveDefs(tenantId, "PACKING");
  const def = approachWaveId === NO_ZONE ? null : defs.find((d) => d.id === approachWaveId) ?? null;
  if (approachWaveId !== NO_ZONE && !def) {
    throw new PackingSessionError("Onda de aproximação do packing não encontrada", 404);
  }
  const target = def?.id ?? null;
  const key = (loc: ZoneLocation | null) => (def && loc ? sequenceKeyIn(def, loc) : null);
  const minKey = (keys: Array<number | null>) => {
    const valid = keys.filter((k): k is number => k != null);
    return valid.length > 0 ? Math.min(...valid) : null;
  };
  return {
    lines<T extends { waveUrgency: number; pickLocation: ZoneLocation }>(lines: T[]): T[] {
      const own = lines.filter((l) => (matchLocation(defs, l.pickLocation)?.waveId ?? null) === target);
      return sortByUrgencyThenSequence(own, (l) => l.waveUrgency, (l) => key(l.pickLocation));
    },
    orders<
      T extends {
        packingUrgency: number;
        items: Array<{ quantityPicked: number; quantityOrdered: number; pickLocation: ZoneLocation | null }>;
      },
    >(orders: T[]): T[] {
      const own = orders.filter(
        (o) =>
          packingZoneFor(
            o.items.map((i) => ({ quantity: i.quantityPicked || i.quantityOrdered, location: i.pickLocation })),
            defs,
          ) === target,
      );
      return sortByUrgencyThenSequence(
        own,
        (o) => o.packingUrgency,
        (o) => minKey(o.items.map((i) => key(i.pickLocation))),
      );
    },
  };
}
```

Em `listUnifiedPackingQueue`:
  - Assinatura: `export async function listUnifiedPackingQueue(tenantId: string, opts?: { approachWaveId?: string }) {`.
  - Logo após o `Promise.all`:

```ts
  const zone = opts?.approachWaveId ? await packingZoneFilter(tenantId, opts.approachWaveId) : null;
  const waveLines = zone ? zone.lines(waveRaw.lines) : waveRaw.lines;
  const queueOrders = zone ? zone.orders(ordersResult.orders) : ordersResult.orders;
```

  - Troque `for (const line of waveRaw.lines)` por `for (const line of waveLines)` e `for (const order of ordersResult.orders)` por `for (const order of queueOrders)`.

- [ ] **Step 2: Rota.** Em `web.ts`:

```ts
  app.get<{ Querystring: { approachWaveId?: string } }>(
    "/api/packing/queue/unified",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await listUnifiedPackingQueue(tenantWhere(request).tenantId, {
          approachWaveId: request.query.approachWaveId?.trim() || undefined,
        });
      } catch (e) {
        if (e instanceof PackingSessionError) return reply.status(e.statusCode).send({ error: e.message });
        throw e;
      }
    },
  );
```

(Se `PackingSessionError` ainda não estiver importado em `web.ts`, importe de `../services/order-packing.js`.)

- [ ] **Step 3: Cliente web.** Em `operations.ts`:

```ts
export function fetchUnifiedPackingQueue(approachWaveId?: string) {
  const qs = approachWaveId ? `?approachWaveId=${encodeURIComponent(approachWaveId)}` : "";
  return apiFetch<{ items: PackingQueueItem[] }>(`/api/packing/queue/unified${qs}`);
}
```

- [ ] **Step 4: Tela do packing.** Em `packing/page.tsx`:
  - Import: `import { fetchTenantApproachWaves, type ApproachWaveSummary } from "@/lib/api/approach-waves";`.
  - Estados e carga:

```tsx
const ZONE_STORAGE_KEY = "packing.approachWaveId";

  const [zones, setZones] = useState<ApproachWaveSummary[]>([]);
  const [zone, setZone] = useState("");

  useEffect(() => {
    setZone(window.localStorage.getItem(ZONE_STORAGE_KEY) ?? "");
    fetchTenantApproachWaves("PACKING")
      .then((d) => setZones(d.waves))
      .catch(() => setZones([]));
  }, []);

  const changeZone = (value: string) => {
    setZone(value);
    if (value) window.localStorage.setItem(ZONE_STORAGE_KEY, value);
    else window.localStorage.removeItem(ZONE_STORAGE_KEY);
  };
```

  (`ZONE_STORAGE_KEY` fica fora do componente, junto de `type QueueFilter`.)

  - `loadQueue`: `const data = await fetchUnifiedPackingQueue(zone || undefined);` e dependências `[zone]`.
  - Ao lado do `<MarketplaceFilter …/>`, dentro do mesmo `div`:

```tsx
            {zones.length > 0 ? (
              <select
                value={zone}
                onChange={(e) => changeZone(e.target.value)}
                className="rounded-lg border bg-white px-3 py-2 text-sm"
                title="Onda de aproximação desta mesa"
              >
                <option value="">Todas as áreas</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
                <option value="none">Sem área</option>
              </select>
            ) : null}
```

  - Se a área salva no navegador sumir do cadastro, a API responde 404. Nesse caso, o `catch` de `loadQueue` limpa a seleção: troque o `catch` por:

```tsx
    } catch (e) {
      if (zone && e instanceof Error && e.message.includes("não encontrada")) {
        changeZone("");
        return;
      }
      setError(e instanceof Error ? e.message : "Erro ao carregar fila");
    }
```

- [ ] **Step 5: Typecheck, testes e navegador.**
  - Run: `cd apps/api && node_modules/.bin/tsc --noEmit && npm test`. Expected: sem erros e PASS.
  - Run: `cd apps/web && node_modules/.bin/tsc --noEmit`. Expected: sem erros.
  - Cadastre uma onda de Packing no mapa (aba Packing).
  - Em `/packing`: o seletor aparece; escolher a área filtra a fila; "Todas as áreas" mostra tudo; recarregar mantém a escolha. Tire screenshot.
  - Apague as ondas de teste ao final, se o usuário não quiser mantê-las.

- [ ] **Step 6: Commit (com autorização).**

```bash
git add apps/api/src/services/order-packing.ts apps/api/src/routes/web.ts apps/web/lib/api/operations.ts "apps/web/app/(dashboard)/packing/page.tsx"
git commit -m "feat(packing): fila filtrada e ordenada por onda de aproximação"
```

---

### Task 11: Verificação ponta a ponta do picking por partes

**Files:**
- Nenhum arquivo de código; só dados de teste no banco local, apagados ao final.

**Interfaces:**
- Consumes: tudo das Tasks 1 a 10.

- [ ] **Step 1: Preparar.**
  - Confirme que o banco é o local (`localhost:5435`).
  - Peça ao usuário um ou mais pedidos de teste, ou crie pedidos PENDING de teste no tenant local com itens em C e em K. Anote os ids para apagar depois.

- [ ] **Step 2: Liberar.**
  - Em `/ondas` → "Montar onda", com o marketplace dos pedidos de teste: modo "Por onda de aproximação", selecione os pedidos e libere.
  - Esperado: mensagem de onda criada.
  - Via CDP: `fetch('/api/waves')` lista a onda.
  - Como o endpoint `/mobile/waves/released` exige token do celular, confirme as partes pelo Prisma Studio ou por `psql` no container local: `SELECT name, "acceptedById" FROM pick_wave_parts WHERE "waveId" = '<id>';`.
  - Esperado: uma parte por área com linhas (+ "Sem área", se houver).

- [ ] **Step 3: Aceite por parte (celular ou API).**
  - Com o app do celular apontando para a API local, a lista mostra "Onda … · Onda 1" e "Onda … · Onda 2". Aceite a Onda 1 com o usuário A: a Onda 2 continua "Disponível para aceite".
  - Sem o celular, chame `POST /mobile/waves/<waveId>/accept?partId=<parte>` com tokens de dois usuários de teste.
  - Esperado: o segundo aceite da mesma parte retorna 409, e coletar uma linha de outra parte retorna 403.

- [ ] **Step 4: Onda única.** Libere outros pedidos de teste, de áreas diferentes, em "Onda única (personalizada)".
  - Esperado: uma onda, sem partes, aceita por um separador (fluxo atual).

- [ ] **Step 5: Limpeza.** Encerre as ondas de teste e apague-as junto com pedidos, alocações e linhas de teste, por ids, num `psql` local ou num script Prisma.
  - Confira que nenhum pedido real do usuário mudou de status.

- [ ] **Step 6: Suite final.**
  - Run: `cd apps/api && npm test && node_modules/.bin/tsc --noEmit`
  - Run: `cd apps/web && node_modules/.bin/tsc --noEmit`
  - Run: `cd apps/mobile && node_modules/.bin/tsc --noEmit`
  - Expected: tudo verde.

---

### Task 12: Documentação de operação

**Files:**
- Modify: `docs/logica-ondas.md`
- Modify: `docs/superpowers/specs/2026-10-02-ondas-aproximacao-design.md` (só se algo mudou na implementação)

- [ ] **Step 1: Seção nova.** No fim de `docs/logica-ondas.md`, adicione:

```markdown
## Ondas de aproximação

Áreas fixas de trabalho cadastradas no **Mapa do galpão → Ondas de aproximação**, separadas em **Picking** e **Packing**. Cada onda tem nome, cor, saída (clique numa célula livre) e paradas em ordem (clique no lado de uma gôndola ou parte; "de/até" define a faixa de colunas e o sentido, ex.: `E 14→8`). Duas ondas do mesmo tipo não podem ter a mesma coluna.

### Picking

- Modo **Por onda de aproximação** (`BY_APPROACH`): todos os pedidos liberados vão para um lote, dividido em **partes** (uma por área com coletas, mais "Sem área" para o que estiver fora das áreas).
- Cada separador aceita uma parte no celular e vê as coletas na ordem das paradas.
- Um pedido com itens em áreas diferentes é coletado pelas partes de cada área e se junta no packing.
- Modo **Onda única** (`SINGLE_WAVE`): todos os pedidos escolhidos numa onda, sem divisão, com um separador. Serve para adiantar pedidos espalhados.
- Ao anexar pedidos a uma onda `BY_APPROACH`, as linhas novas entram na parte da área (criada se faltar).

### Packing

- O packing confere o que o picking coletou, embala e imprime a etiqueta; não precisa ser quem separou.
- Na tela do Packing, o seletor **Onda de aproximação** (lembrado no navegador da mesa) filtra a fila:
  - pedidos vão para a área com mais unidades (empate: a primeira do cadastro);
  - linhas de lote vão para a área da gôndola.
- Dentro da área, a fila segue a urgência e depois a ordem das paradas.

### Sem cadastro

Nada muda. O modo `BY_APPROACH` avisa que é preciso cadastrar as ondas de picking.
```

- [ ] **Step 2: Commit (com autorização).**

```bash
git add docs/logica-ondas.md docs/superpowers/specs/2026-10-02-ondas-aproximacao-design.md docs/superpowers/plans/2026-10-02-ondas-aproximacao.md
git commit -m "docs: ondas de aproximação"
```
