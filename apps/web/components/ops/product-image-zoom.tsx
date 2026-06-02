"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

const ZOOM_SCALE = 1.55;
const VIEWPORT_PADDING_PX = 8;

type ProductImageZoomProps = {
  src: string | null | undefined;
  alt: string;
  /** Classes do slot (ex.: aspect-square w-40 shrink-0) */
  className?: string;
  placeholder?: string;
  sizes?: string;
};

/** Amplia centralizado sobre o slot da miniatura (mesmo lugar na tela). */
function computeZoomPopoverStyle(
  anchor: DOMRect,
  zoomSize: number,
): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.left + anchor.width / 2 - zoomSize / 2;
  let top = anchor.top + anchor.height / 2 - zoomSize / 2;

  left = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(left, vw - zoomSize - VIEWPORT_PADDING_PX),
  );
  top = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(top, vh - zoomSize - VIEWPORT_PADDING_PX),
  );

  return {
    position: "fixed",
    left,
    top,
    width: zoomSize,
    height: zoomSize,
    zIndex: 100,
  };
}

export function ProductImageZoom({
  src,
  alt,
  className = "relative aspect-square w-40 shrink-0",
  placeholder,
  sizes = "160px",
}: ProductImageZoomProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  const syncPopoverPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const base = Math.max(rect.width, rect.height);
    const zoomSize = Math.round(base * ZOOM_SCALE);
    setPopoverStyle(computeZoomPopoverStyle(rect, zoomSize));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!hovered || !src) return;
    syncPopoverPosition();
    window.addEventListener("scroll", syncPopoverPosition, true);
    window.addEventListener("resize", syncPopoverPosition);
    return () => {
      window.removeEventListener("scroll", syncPopoverPosition, true);
      window.removeEventListener("resize", syncPopoverPosition);
    };
  }, [hovered, src, syncPopoverPosition]);

  const showPopover = mounted && hovered && src && popoverStyle;

  const stayHovered = (relatedTarget: EventTarget | null) =>
    relatedTarget instanceof Node &&
    (anchorRef.current?.contains(relatedTarget) ||
      zoomLayerRef.current?.contains(relatedTarget));

  return (
    <>
      <div
        ref={anchorRef}
        className={className}
        onMouseEnter={() => {
          setHovered(true);
          syncPopoverPosition();
        }}
        onMouseLeave={(e) => {
          if (!stayHovered(e.relatedTarget)) setHovered(false);
        }}
      >
        <div
          className={`relative h-full w-full overflow-hidden rounded-md bg-slate-100 ${
            hovered && src ? "invisible" : ""
          }`}
        >
          {src ? (
            <Image
              src={src}
              alt={alt}
              fill
              className="object-contain"
              sizes={sizes}
              unoptimized
            />
          ) : (
            <div className="flex h-full min-h-[4rem] items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {placeholder ?? alt}
            </div>
          )}
        </div>
      </div>

      {showPopover
        ? createPortal(
            <div
              ref={zoomLayerRef}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
              style={popoverStyle}
              onMouseLeave={(e) => {
                if (!stayHovered(e.relatedTarget)) setHovered(false);
              }}
              role="presentation"
              aria-hidden
            >
              <div className="pointer-events-none relative h-full w-full">
                <Image
                  src={src}
                  alt=""
                  fill
                  className="object-contain p-1"
                  sizes={`${popoverStyle.width}px`}
                  unoptimized
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
