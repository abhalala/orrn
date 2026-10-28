import type { LabelDocument, LabelElement } from "@orrn/domain";
import { useId, useMemo } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { dots, elementShape, mmFromDots, type ElementShape, type LabelValues } from "./label-metrics";

/** Thermal print is black on white whatever the app theme. */
const INK = "#0c0c0e";
const FONT = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

function qrPath(shape: Extract<ElementShape, { kind: "qrcode" }>): string {
  const { matrix, cellMm } = shape;
  if (!matrix) return "";
  let path = "";
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.dark(row, column)) path += `M${column * cellMm} ${row * cellMm}h${cellMm}v${cellMm}h${-cellMm}z`;
    }
  }
  return path;
}

function barRects(shape: Extract<ElementShape, { kind: "barcode" }>): Array<{ x: number; width: number }> {
  const bars: Array<{ x: number; width: number }> = [];
  const pattern = shape.pattern ?? "";
  let index = 0;
  while (index < pattern.length) {
    if (pattern[index] !== "1") {
      index += 1;
      continue;
    }
    const start = index;
    while (pattern[index] === "1") index += 1;
    bars.push({ x: start * shape.moduleMm, width: (index - start) * shape.moduleMm });
  }
  return bars;
}

/**
 * One element drawn at its printed size in label millimetres, unrotated with its origin at 0,0.
 * `editing` outlines a field that is empty for this bundle so it can still be found and moved;
 * a print preview leaves it blank, as the label will be.
 */
export function ElementArtwork({ element, shape, editing = false }: { element: LabelElement; shape: ElementShape; editing?: boolean }) {
  switch (shape.kind) {
    case "text":
      if (!shape.text && !editing) return null;
      return shape.text ? (
        <text
          x={0}
          y={shape.heightMm * 0.8}
          fill={INK}
          fontFamily={FONT}
          fontWeight={600}
          fontSize={shape.heightMm * 0.92}
          textLength={shape.widthMm}
          lengthAdjust="spacingAndGlyphs"
          xmlSpace="preserve"
        >
          {shape.text}
        </text>
      ) : (
        <rect width={shape.widthMm} height={shape.heightMm} fill="none" stroke={INK} strokeOpacity={0.25} strokeDasharray="0.6 0.6" strokeWidth={0.15} />
      );
    case "qrcode":
      return shape.matrix ? (
        <path d={qrPath(shape)} fill={INK} shapeRendering="crispEdges" />
      ) : (
        <SymbolPlaceholder widthMm={shape.widthMm} heightMm={shape.heightMm} label="QR" />
      );
    case "barcode":
      if (!shape.pattern) return <SymbolPlaceholder widthMm={shape.widthMm} heightMm={shape.heightMm} label={element.symbology ?? "Barcode"} />;
      return (
        <g>
          {barRects(shape).map((bar) => (
            <rect key={bar.x} x={bar.x} width={bar.width} height={shape.barHeightMm} fill={INK} shapeRendering="crispEdges" />
          ))}
          {shape.readable ? (
            <text x={shape.widthMm / 2} y={shape.barHeightMm + 2.4} textAnchor="middle" fill={INK} fontFamily={FONT} fontWeight={600} fontSize={2.4}>
              {shape.text}
            </text>
          ) : null}
        </g>
      );
    case "line":
      return <rect width={shape.widthMm} height={Math.max(shape.heightMm, shape.strokeMm)} fill={INK} />;
    case "box":
      return (
        <rect
          x={shape.strokeMm / 2}
          y={shape.strokeMm / 2}
          width={Math.max(shape.widthMm - shape.strokeMm, 0)}
          height={Math.max(shape.heightMm - shape.strokeMm, 0)}
          fill="none"
          stroke={INK}
          strokeWidth={shape.strokeMm}
        />
      );
    default:
      return <SymbolPlaceholder widthMm={shape.widthMm} heightMm={shape.heightMm} label={element.type} />;
  }
}

function SymbolPlaceholder({ widthMm, heightMm, label }: { widthMm: number; heightMm: number; label: string }) {
  return (
    <g>
      <rect width={widthMm} height={heightMm} fill={INK} fillOpacity={0.06} stroke={INK} strokeOpacity={0.4} strokeWidth={0.2} strokeDasharray="0.8 0.6" />
      <text x={widthMm / 2} y={heightMm / 2 + 0.9} textAnchor="middle" fill={INK} fillOpacity={0.6} fontFamily={FONT} fontSize={2.4}>
        {label}
      </text>
    </g>
  );
}

/** Element origin snapped to printer dots, plus the clockwise TSPL rotation. */
export function elementTransform(element: LabelElement, offset = { x: 0, y: 0 }): string {
  const x = mmFromDots(dots(element.xMm + offset.x));
  const y = mmFromDots(dots(element.yMm + offset.y));
  return element.rotation ? `translate(${x} ${y}) rotate(${element.rotation})` : `translate(${x} ${y})`;
}

/** Corner radius of die-cut label stock. */
export const LABEL_RADIUS_MM = 1.5;

/**
 * Read-only print preview of a label with real values: actual QR modules, Code 128 bars and font-3
 * text at their printed sizes on a white label. A design aid; the agent's TSPL is authoritative.
 */
export function LabelPreview({
  document,
  values,
  className,
  title,
}: {
  document: LabelDocument;
  values: LabelValues;
  className?: string;
  title: string;
}) {
  const clipId = useId();
  const { widthMm, heightMm } = document.page;
  const shapes = useMemo(() => document.elements.map((element) => ({ element, shape: elementShape(element, values) })), [document, values]);
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${widthMm} ${heightMm}`}
      className={cn("block h-auto w-full rounded-[3px] bg-white shadow-[0_1px_2px_rgb(12_12_14/0.10),0_6px_16px_rgb(12_12_14/0.08)] ring-1 ring-black/5", className)}
      style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
    >
      <clipPath id={clipId}>
        <rect width={widthMm} height={heightMm} rx={LABEL_RADIUS_MM} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect width={widthMm} height={heightMm} fill="#ffffff" />
        {shapes.map(({ element, shape }) => (
          <g key={element.id} transform={elementTransform(element)}>
            <ElementArtwork element={element} shape={shape} />
          </g>
        ))}
      </g>
    </svg>
  );
}
