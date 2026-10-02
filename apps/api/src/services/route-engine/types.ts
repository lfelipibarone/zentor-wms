export type Face = "A" | "B";

export type FloorElementKind =
  | "GONDOLA"
  | "OBSTACLE"
  | "START_POINT"
  | "PACKING_POINT"
  | "DOCK"
  | "RECEIVING_AREA";

export type FloorElementSpec = {
  id: string;
  type: FloorElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Estante do LD (Face A); também do LE quando `estanteIdB` é nulo. */
  estanteId?: string | null;
  /** Estante do LE (Face B) quando a gôndola junta duas estantes de costas. */
  estanteIdB?: string | null;
  faceAEnabled: boolean;
  faceBEnabled: boolean;
  colunaReversedA: boolean;
  colunaReversedB: boolean;
  /** Faixa de colunas atendida em cada lado (nulo = sem limite): parte 1 e parte 2 da mesma estante. */
  colunaMinA?: number | null;
  colunaMaxA?: number | null;
  colunaMinB?: number | null;
  colunaMaxB?: number | null;
  label?: string | null;
};

export type FloorPlanSpec = {
  id: string;
  barracaoId: string;
  cellSizeCm: number;
  widthCells: number;
  heightCells: number;
  version: number;
  elements: FloorElementSpec[];
};

/**
 * Códigos de coluna de cada lado da estante (A = LD, B = LE), em ordem numérica.
 * As colunas correm ao longo da gôndola; a linha é a altura e não muda o ponto de acesso.
 */
export type FaceSlots = Record<Face, string[]>;
export type GondolaSlots = Map<string, FaceSlots>;

/** Localização mínima que qualquer fluxo consegue fornecer ao motor de rota. */
export type RoutableLocation = {
  id?: string;
  corridor: string;
  /** "COLUNA-LINHA" (ex.: "8-3"); a coluna é a posição ao longo da gôndola. */
  row: string;
  estanteId?: string | null;
  face?: Face | string | null;
};

export type RoutePoint = { planId: string; cell: number };

export type RouteEngineKind = "LEGACY" | "PHYSICAL";

/** De onde a rota parte quando não há localização anterior: início da separação ou área de recebimento. */
export type RouteOrigin = "START" | "RECEIVING";

export interface RouteEngine {
  readonly kind: RouteEngineKind;
  /** PHYSICAL: metros de caminhada; LEGACY: unidades Manhattan corredor/linha. */
  distance(a: RoutableLocation, b: RoutableLocation): number;
  sortByRoute<T extends RoutableLocation>(
    locations: T[],
    start?: RoutableLocation | null,
    origin?: RouteOrigin,
  ): T[];
  locate(loc: RoutableLocation): RoutePoint | null;
}
