"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

const MAX_ZOOM = 6;
/** Menor zoom, em fração do zoom em que o barracão inteiro preenche a moldura. */
const MIN_FIT_RATIO = 0.25;
/** Movimento mínimo (px) para um clique virar arrasto do mapa. */
const PAN_THRESHOLD = 5;
const MINIMAP_MAX_W = 168;
const MINIMAP_MAX_H = 112;

/** Posição no eixo: se o mapa cabe, fica centralizado; se não, não deixa a borda entrar na moldura. */
function clampAxis(pos: number, content: number, frame: number) {
  if (content <= frame) return (frame - content) / 2;
  return Math.min(0, Math.max(frame - content, pos));
}

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
 * Moldura fixa no formato do barracão, com o mapa preso dentro: abaixo de "inteiro" o mapa encolhe
 * centralizado, e ao aproximar só dá para andar até as bordas. Roda do mouse ou pinça: zoom
 * no ponto do cursor; rolagem de dois dedos ou arrastar o fundo (ou espaço + arrastar, botão do meio):
 * mover. Cliques que o filho não tratar (sem `stopPropagation`) podem virar arrasto.
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
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const miniDragRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: contentWidth, h: contentHeight });
  sizeRef.current = { w: contentWidth, h: contentHeight };

  /** Zoom em que o mapa inteiro preenche a moldura (= 100%). */
  const fitZoom = useCallback(() => {
    const el = ref.current;
    const { w, h } = sizeRef.current;
    if (!el || w <= 0 || h <= 0) return 1;
    return Math.min(el.clientWidth / w, el.clientHeight / h);
  }, []);

  const apply = useCallback(
    (next: View) => {
      const el = ref.current;
      if (el) {
        const zoom = Math.min(MAX_ZOOM, Math.max(fitZoom() * MIN_FIT_RATIO, next.zoom));
        next = {
          zoom,
          x: clampAxis(next.x, sizeRef.current.w * zoom, el.clientWidth),
          y: clampAxis(next.y, sizeRef.current.h * zoom, el.clientHeight),
        };
      }
      viewRef.current = next;
      setView(next);
    },
    [fitZoom],
  );

  /** Zoom mantendo fixo o ponto (px, py) da moldura. */
  const zoomAt = useCallback(
    (next: number, px?: number, py?: number) => {
      const el = ref.current;
      if (!el) return;
      const v = viewRef.current;
      const z = Math.min(MAX_ZOOM, Math.max(fitZoom() * MIN_FIT_RATIO, next));
      const x = px ?? el.clientWidth / 2;
      const y = py ?? el.clientHeight / 2;
      apply({ zoom: z, x: x - ((x - v.x) / v.zoom) * z, y: y - ((y - v.y) / v.zoom) * z });
    },
    [apply, fitZoom],
  );

  const fit = useCallback(() => apply({ zoom: fitZoom(), x: 0, y: 0 }), [apply, fitZoom]);

  useLayoutEffect(() => {
    fit();
  }, [fitKey, contentWidth, contentHeight, fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Moldura mudou de tamanho (janela, painel): mantém o mapa preso e reajusta o zoom mínimo.
    const ro = new ResizeObserver(() => {
      setFrame({ w: el.clientWidth, h: el.clientHeight });
      const v = viewRef.current;
      if (Math.abs(v.zoom / fitZoom() - 1) < 0.001) fit();
      else apply(v);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply, fit, fitZoom]);

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

  const miniScale =
    contentWidth > 0 && contentHeight > 0 ? Math.min(MINIMAP_MAX_W / contentWidth, MINIMAP_MAX_H / contentHeight) : 0;
  const miniContent = useMemo(() => (miniScale > 0 ? children(miniScale) : null), [children, miniScale]);
  const showMinimap = miniScale > 0 && frame.w > 0 && view.zoom > fitZoom() * 1.01;
  const miniRect = {
    left: (-view.x / view.zoom) * miniScale,
    top: (-view.y / view.zoom) * miniScale,
    width: (frame.w / view.zoom) * miniScale,
    height: (frame.h / view.zoom) * miniScale,
  };

  /** Centraliza a visão no ponto do minimapa sob o ponteiro. */
  const moveToMinimap = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const cx = (ev.clientX - r.left) / miniScale;
    const cy = (ev.clientY - r.top) / miniScale;
    const v = viewRef.current;
    apply({ ...v, x: el.clientWidth / 2 - cx * v.zoom, y: el.clientHeight / 2 - cy * v.zoom });
  };

  return (
    <div>
      <div className="bg-slate-100">
        <div
          ref={ref}
          className="relative mx-auto overflow-hidden bg-slate-100"
          style={{
            aspectRatio: contentWidth > 0 && contentHeight > 0 ? `${contentWidth} / ${contentHeight}` : undefined,
            maxHeight: height,
            minHeight: 200,
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
          {showMinimap && (
            <div
              title="Arraste o quadrado para andar pelo barracão"
              className="absolute bottom-2 right-2 cursor-pointer overflow-hidden rounded-md border border-slate-300 bg-white shadow-md"
              style={{ width: contentWidth * miniScale, height: contentHeight * miniScale }}
              onPointerDown={(ev) => {
                if (ev.button !== 0) return;
                ev.stopPropagation();
                miniDragRef.current = ev.pointerId;
                ev.currentTarget.setPointerCapture(ev.pointerId);
                moveToMinimap(ev);
              }}
              onPointerMove={(ev) => {
                if (miniDragRef.current === ev.pointerId) moveToMinimap(ev);
              }}
              onPointerUp={() => (miniDragRef.current = null)}
              onPointerCancel={() => (miniDragRef.current = null)}
            >
              <div className="pointer-events-none select-none" aria-hidden inert>
                {miniContent}
              </div>
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-sky-500 bg-sky-400/15"
                style={miniRect}
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t bg-white px-3 py-1">
        <span className="truncate text-[11px] text-slate-400">
          Rodinha ou pinça: aproximar · arraste o fundo (ou espaço + arrastar): mover · 0: barracão inteiro
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
          <span title="100% = barracão inteiro" className="w-12 text-center text-xs font-medium text-slate-600">
            {Math.round((view.zoom / fitZoom()) * 100)}%
          </span>
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
            title="Ver o barracão inteiro (0)"
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
