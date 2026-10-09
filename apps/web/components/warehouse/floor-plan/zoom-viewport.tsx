"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
/** Movimento mínimo (px) para um clique virar arrasto do mapa. */
const PAN_THRESHOLD = 5;
/** Quanto do mapa (px) sempre fica visível ao arrastar para fora. */
const KEEP_VISIBLE = 60;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

/** Roda de mouse (passos grandes e inteiros) vs. rolagem de dois dedos no trackpad (passos pequenos, com X). */
function isMouseWheel(ev: WheelEvent) {
  if (ev.deltaMode !== 0) return true;
  return ev.deltaX === 0 && Number.isInteger(ev.deltaY) && Math.abs(ev.deltaY) >= 50;
}

type View = { zoom: number; x: number; y: number };
type Pan = { pointerId: number; x: number; y: number; startX: number; startY: number; active: boolean };
type GestureLike = Event & { scale: number; clientX: number; clientY: number };

/**
 * Moldura fixa com o mapa dentro (como um canvas): o tamanho da área nunca muda, só o conteúdo
 * aproxima/afasta e se move. Roda do mouse ou pinça: zoom no ponto do cursor; rolagem de dois dedos
 * ou arrastar o fundo (ou espaço + arrastar, botão do meio): mover. Cliques que o filho não tratar
 * (sem `stopPropagation`) podem virar arrasto.
 */
export function ZoomViewport({
  contentWidth,
  contentHeight,
  fitKey,
  height = "70vh",
  children,
}: {
  /** Tamanho do conteúdo em px com zoom 1. */
  contentWidth: number;
  contentHeight: number;
  /** Ao mudar, reajusta o zoom para caber na moldura. */
  fitKey?: string;
  height?: string;
  children: (zoom: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const panRef = useRef<Pan | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const hoverRef = useRef(false);
  const sizeRef = useRef({ w: contentWidth, h: contentHeight });
  sizeRef.current = { w: contentWidth, h: contentHeight };

  const apply = useCallback((next: View) => {
    const el = ref.current;
    if (el) {
      const w = sizeRef.current.w * next.zoom;
      const h = sizeRef.current.h * next.zoom;
      next = {
        zoom: next.zoom,
        x: Math.min(el.clientWidth - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - w, next.x)),
        y: Math.min(el.clientHeight - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - h, next.y)),
      };
    }
    viewRef.current = next;
    setView(next);
  }, []);

  /** Zoom mantendo fixo o ponto (px, py) da moldura. */
  const zoomAt = useCallback(
    (next: number, px?: number, py?: number) => {
      const el = ref.current;
      if (!el) return;
      const v = viewRef.current;
      const z = clampZoom(next);
      const x = px ?? el.clientWidth / 2;
      const y = py ?? el.clientHeight / 2;
      apply({ zoom: z, x: x - ((x - v.x) / v.zoom) * z, y: y - ((y - v.y) / v.zoom) * z });
    },
    [apply],
  );

  const fit = useCallback(() => {
    const el = ref.current;
    const { w, h } = sizeRef.current;
    if (!el || w <= 0 || h <= 0) return;
    const pad = 16;
    const z = clampZoom(Math.min((el.clientWidth - pad * 2) / w, (el.clientHeight - pad * 2) / h, 2.5));
    apply({ zoom: z, x: (el.clientWidth - w * z) / 2, y: (el.clientHeight - h * z) / 2 });
  }, [apply]);

  useLayoutEffect(() => {
    fit();
    // Reajusta só quando a planta muda (fitKey), não a cada edição de tamanho.
  }, [fitKey, fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const local = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top] as const;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const [px, py] = local(ev.clientX, ev.clientY);
      const v = viewRef.current;
      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(v.zoom * Math.exp(-ev.deltaY * 0.01), px, py);
      } else if (isMouseWheel(ev)) {
        zoomAt(v.zoom * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025)), px, py);
      } else {
        apply({ ...v, x: v.x - ev.deltaX, y: v.y - ev.deltaY });
      }
    };
    // Safari: pinça no trackpad vem como gesture*, não como wheel; sem isso a página inteira aumenta.
    let gestureBase = 1;
    const onGestureStart = (ev: Event) => {
      ev.preventDefault();
      gestureBase = viewRef.current.zoom;
    };
    const onGestureChange = (ev: Event) => {
      ev.preventDefault();
      const g = ev as GestureLike;
      const [px, py] = local(g.clientX, g.clientY);
      zoomAt(gestureBase * g.scale, px, py);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureStart);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureStart);
    };
  }, [zoomAt, apply]);

  useEffect(() => {
    const onDown = (ev: KeyboardEvent) => {
      if (!hoverRef.current || isTypingTarget(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === " ") {
        ev.preventDefault();
        setSpaceDown(true);
      } else if (ev.key === "+" || ev.key === "=") {
        zoomAt(viewRef.current.zoom * 1.25);
      } else if (ev.key === "-" || ev.key === "_") {
        zoomAt(viewRef.current.zoom / 1.25);
      } else if (ev.key === "0") {
        fit();
      }
    };
    const onUp = (ev: KeyboardEvent) => {
      if (ev.key === " ") setSpaceDown(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [zoomAt, fit]);

  const beginPan = (ev: ReactPointerEvent<HTMLDivElement>, active: boolean) => {
    const v = viewRef.current;
    panRef.current = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, startX: v.x, startY: v.y, active };
    if (active) {
      ref.current?.setPointerCapture(ev.pointerId);
      setPanning(true);
    }
  };

  const onPointerDownCapture = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (ev.button === 1 || (ev.button === 0 && spaceDown)) {
      ev.preventDefault();
      ev.stopPropagation();
      beginPan(ev, true);
    }
  };

  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (ev.button === 0 && !panRef.current) beginPan(ev, false);
  };

  const onPointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== ev.pointerId) return;
    const dx = ev.clientX - pan.x;
    const dy = ev.clientY - pan.y;
    if (!pan.active) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      pan.active = true;
      ref.current?.setPointerCapture(ev.pointerId);
      setPanning(true);
    }
    apply({ ...viewRef.current, x: pan.startX + dx, y: pan.startY + dy });
  };

  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };

  return (
    <div>
      <div
        ref={ref}
        className="relative overflow-hidden bg-slate-100/60"
        style={{
          height,
          touchAction: "none",
          overscrollBehavior: "contain",
          cursor: panning ? "grabbing" : spaceDown ? "grab" : undefined,
        }}
        onPointerEnter={() => (hoverRef.current = true)}
        onPointerLeave={() => (hoverRef.current = false)}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onAuxClick={(ev) => ev.preventDefault()}
      >
        <div
          className="absolute left-0 top-0 w-max"
          style={{
            transform: `translate(${view.x}px, ${view.y}px)`,
            pointerEvents: panning || spaceDown ? "none" : undefined,
          }}
        >
          {children(view.zoom)}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t bg-white px-3 py-1">
        <span className="truncate text-[11px] text-slate-400">
          Rodinha ou pinça: zoom · arraste o fundo (ou espaço + arrastar): mover · + / − / 0
        </span>
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            title="Diminuir zoom (−)"
            onClick={() => zoomAt(view.zoom / 1.25)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Voltar para 100%"
            onClick={() => zoomAt(1)}
            className="w-12 rounded-md py-1 text-center text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button
            type="button"
            title="Aumentar zoom (+)"
            onClick={() => zoomAt(view.zoom * 1.25)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Ajustar à tela (0)"
            onClick={fit}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
