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

const PAD = 12;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
/** Movimento mínimo (px) para um clique virar arrasto do mapa. */
const PAN_THRESHOLD = 5;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

type Pan = { pointerId: number; x: number; y: number; left: number; top: number; active: boolean };

/**
 * Área com zoom e arrasto para o mapa. ⌘/Ctrl + rolagem (ou pinça no trackpad) aproxima no ponto do cursor;
 * arrastar o fundo, o botão do meio ou espaço + arrastar move o mapa. Cliques que o filho não tratar
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
  /** Ao mudar, reajusta o zoom para caber na tela. */
  fitKey?: string;
  height?: string;
  children: (zoom: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const anchorRef = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const panRef = useRef<Pan | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const hoverRef = useRef(false);

  /** Zoom mantendo fixo o ponto da tela (px, py) relativo à área. */
  const zoomAt = useCallback((next: number, px?: number, py?: number) => {
    const el = ref.current;
    if (!el) return;
    const z = clampZoom(next);
    const x = px ?? el.clientWidth / 2;
    const y = py ?? el.clientHeight / 2;
    // Vários eventos antes do render (pinça no trackpad): o scroll ainda não foi ajustado, reaproveita a âncora.
    const pending = anchorRef.current;
    anchorRef.current = {
      cx: pending ? pending.cx + (x - pending.px) / zoomRef.current : (el.scrollLeft + x - PAD) / zoomRef.current,
      cy: pending ? pending.cy + (y - pending.py) / zoomRef.current : (el.scrollTop + y - PAD) / zoomRef.current,
      px: x,
      py: y,
    };
    zoomRef.current = z;
    setZoom(z);
  }, []);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || contentWidth <= 0 || contentHeight <= 0) return;
    const z = Math.min((el.clientWidth - PAD * 2) / contentWidth, (el.clientHeight - PAD * 2) / contentHeight, 2.5);
    const fitted = clampZoom(Math.round(z * 100) / 100);
    anchorRef.current = null;
    zoomRef.current = fitted;
    setZoom(fitted);
    el.scrollTo({ left: 0, top: 0 });
  }, [contentWidth, contentHeight]);

  useLayoutEffect(() => {
    fit();
    // Reajusta só quando a planta muda (fitKey), não a cada edição de tamanho.
  }, [fitKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    const a = anchorRef.current;
    if (!el || !a) return;
    el.scrollLeft = a.cx * zoom + PAD - a.px;
    el.scrollTop = a.cy * zoom + PAD - a.py;
    anchorRef.current = null;
  }, [zoom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025));
      zoomAt(zoomRef.current * factor, ev.clientX - rect.left, ev.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const onDown = (ev: KeyboardEvent) => {
      if (!hoverRef.current || isTypingTarget(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === " ") {
        ev.preventDefault();
        setSpaceDown(true);
      } else if (ev.key === "+" || ev.key === "=") {
        zoomAt(zoomRef.current * 1.25);
      } else if (ev.key === "-" || ev.key === "_") {
        zoomAt(zoomRef.current / 1.25);
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
    const el = ref.current;
    if (!el) return;
    panRef.current = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, left: el.scrollLeft, top: el.scrollTop, active };
    if (active) {
      el.setPointerCapture(ev.pointerId);
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
    const el = ref.current;
    if (!pan || !el || pan.pointerId !== ev.pointerId) return;
    const dx = ev.clientX - pan.x;
    const dy = ev.clientY - pan.y;
    if (!pan.active) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      pan.active = true;
      el.setPointerCapture(ev.pointerId);
      setPanning(true);
    }
    el.scrollLeft = pan.left - dx;
    el.scrollTop = pan.top - dy;
  };

  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };

  return (
    <div>
      <div
        ref={ref}
        className="overflow-auto bg-slate-100/60"
        style={{ height, cursor: panning ? "grabbing" : spaceDown ? "grab" : undefined }}
        onPointerEnter={() => (hoverRef.current = true)}
        onPointerLeave={() => (hoverRef.current = false)}
        onPointerDownCapture={onPointerDownCapture}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onAuxClick={(ev) => ev.preventDefault()}
      >
        <div className="w-max" style={{ padding: PAD, pointerEvents: panning || spaceDown ? "none" : undefined }}>
          {children(zoom)}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t bg-white px-3 py-1">
        <span className="truncate text-[11px] text-slate-400">
          ⌘/Ctrl + rolar ou pinça: zoom · arraste o fundo (ou espaço + arrastar): mover · + / − / 0
        </span>
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            title="Diminuir zoom (−)"
            onClick={() => zoomAt(zoom / 1.25)}
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
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            title="Aumentar zoom (+)"
            onClick={() => zoomAt(zoom * 1.25)}
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
