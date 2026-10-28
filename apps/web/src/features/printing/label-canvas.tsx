import type { LabelDocument, LabelElement } from "@orrn/domain";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { ElementArtwork, LABEL_RADIUS_MM, elementTransform } from "./label-artwork";
import { elementBounds, elementName, elementShape, round2, type ElementShape, type LabelValues, type Rect } from "./label-metrics";

export const RULER_PX = 24;
export const STAGE_PAD_PX = 28;
/** Snap grid step in millimetres. */
export const SNAP_MM = 0.5;
/** Smart guides catch within this many screen pixels. */
const GUIDE_PX = 6;

const SELECT = "var(--tone-blue-from)";
const GUIDE = "#e11d74";
const WARN = "var(--tone-amber-to)";

type Point = { x: number; y: number };
type Guides = { x: number[]; y: number[] };

type Drag =
  | { kind: "move"; ids: string[]; origin: Point; box: Rect; delta: Point; moved: boolean; guides: Guides }
  | { kind: "resize"; id: string; origin: Point; delta: Point }
  | { kind: "marquee"; origin: Point; current: Point; additive: boolean };

export type ResizeUpdate = Partial<Pick<LabelElement, "fontSizeMm" | "cellMm" | "heightMm" | "widthMm">>;

const snapTo = (value: number, step: number) => Math.round(value / step) * step;

function union(boxes: Rect[]): Rect {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  return { x: left, y: top, width: Math.max(...boxes.map((box) => box.x + box.width)) - left, height: Math.max(...boxes.map((box) => box.y + box.height)) - top };
}

/**
 * Pull a moving box onto the nearest label edge/centre or other element edge/centre within
 * `threshold` mm, per axis. Returns the corrected delta and the guide lines it snapped to.
 */
function smartSnap(box: Rect, delta: Point, targets: { x: number[]; y: number[] }, threshold: number): { delta: Point; guides: Guides } {
  const axis = (start: number, size: number, offset: number, lines: number[]) => {
    let best: { correction: number; line: number } | null = null;
    for (const edge of [start + offset, start + offset + size / 2, start + offset + size]) {
      for (const line of lines) {
        const correction = line - edge;
        if (Math.abs(correction) <= threshold && (!best || Math.abs(correction) < Math.abs(best.correction))) best = { correction, line };
      }
    }
    return best;
  };
  const x = axis(box.x, box.width, delta.x, targets.x);
  const y = axis(box.y, box.height, delta.y, targets.y);
  return {
    delta: { x: delta.x + (x?.correction ?? 0), y: delta.y + (y?.correction ?? 0) },
    guides: { x: x ? [x.line] : [], y: y ? [y.line] : [] },
  };
}

/** Size change from dragging the corner of an unrotated shape by (dx, dy) mm. */
function resizeUpdate(element: LabelElement, shape: ElementShape, dx: number, dy: number): ResizeUpdate | null {
  switch (shape.kind) {
    case "text": {
      // Font 3 prints whole multiples only: 3, 6, 9 mm and so on.
      const scale = Math.max(1, Math.round(((shape.heightMm + dy) / shape.heightMm) * shape.scale));
      return scale === shape.scale ? null : { fontSizeMm: scale * 3 };
    }
    case "qrcode": {
      if (!shape.matrix) return null;
      const cellDots = Math.max(2, Math.round(((shape.widthMm + Math.max(dx, dy)) / shape.matrix.size) * (203 / 25.4)));
      return { cellMm: round2((cellDots * 25.4) / 203) };
    }
    case "barcode":
      return { heightMm: round2(Math.max(3, (element.heightMm ?? shape.barHeightMm) + dy)) };
    default:
      return { widthMm: round2(Math.max(1, shape.widthMm + dx)), heightMm: round2(Math.max(0.25, shape.heightMm + dy)) };
  }
}

/** Pointer delta in screen millimetres, turned into the element's unrotated frame. */
function unrotate(rotation: number, dx: number, dy: number) {
  switch (rotation) {
    case 90:
      return { x: dy, y: -dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: -dy, y: dx };
    default:
      return { x: dx, y: dy };
  }
}

function Ruler({ lengthMm, scale, orientation, cursor }: { lengthMm: number; scale: number; orientation: "horizontal" | "vertical"; cursor?: number }) {
  const horizontal = orientation === "horizontal";
  const span = lengthMm * scale + STAGE_PAD_PX * 2;
  const ticks = [];
  const every = scale < 4 ? 2 : 1;
  for (let mm = 0; mm <= Math.floor(lengthMm); mm += every) {
    const major = mm % 10 === 0;
    const mid = mm % 5 === 0;
    const at = STAGE_PAD_PX + mm * scale;
    const size = major ? 10 : mid ? 7 : 4;
    ticks.push(horizontal ? <line key={mm} x1={at} x2={at} y1={RULER_PX} y2={RULER_PX - size} /> : <line key={mm} y1={at} y2={at} x1={RULER_PX} x2={RULER_PX - size} />);
    if (major)
      ticks.push(
        horizontal ? (
          <text key={`l${mm}`} x={at + 3} y={11} className="fill-muted-foreground stroke-none" fontSize={10}>
            {mm}
          </text>
        ) : (
          <text key={`l${mm}`} x={11} y={at + 3} className="fill-muted-foreground stroke-none" fontSize={10} transform={`rotate(-90 11 ${at + 3})`} textAnchor="end">
            {mm}
          </text>
        ),
      );
  }
  const marker = cursor === undefined ? null : STAGE_PAD_PX + cursor * scale;
  return (
    <svg aria-hidden="true" width={horizontal ? span : RULER_PX} height={horizontal ? RULER_PX : span} className="block stroke-muted-foreground/70 font-mono tabular-nums">
      {ticks}
      {marker === null ? null : horizontal ? (
        <line x1={marker} x2={marker} y1={0} y2={RULER_PX} stroke={GUIDE} strokeWidth={1} />
      ) : (
        <line y1={marker} y2={marker} x1={0} x2={RULER_PX} stroke={GUIDE} strokeWidth={1} />
      )}
    </svg>
  );
}

/**
 * The editable label: millimetre rulers with a cursor marker, the die-cut label at its printed
 * geometry, a 0.5 mm snap grid, smart guides to the label and other elements, drag to move, a
 * corner handle to resize, a marquee on empty label space, Shift-click to add to the selection.
 * Moves and resizes commit once on release, so one drag is one undo step.
 */
export function LabelCanvas({
  document,
  values,
  scale,
  snap,
  selectedIds,
  flaggedIds,
  onSelect,
  onSelectMany,
  onClear,
  onMove,
  onResize,
  onCursor,
}: {
  document: LabelDocument;
  values: LabelValues;
  scale: number;
  snap: boolean;
  selectedIds: string[];
  flaggedIds: ReadonlySet<string>;
  onSelect: (id: string, additive: boolean) => void;
  onSelectMany: (ids: string[], additive: boolean) => void;
  onClear: () => void;
  onMove: (ids: string[], dxMm: number, dyMm: number) => void;
  onResize: (id: string, update: ResizeUpdate) => void;
  onCursor?: (point: Point | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Focus that follows a pointer press must not reselect (it would undo a Shift-click).
  const pointerFocus = useRef(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  // Pointer events can outrun renders; handlers read the latest drag from here, not a stale closure.
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [cursor, setCursor] = useState<Point | null>(null);
  const { widthMm, heightMm } = document.page;
  const placed = useMemo(
    () =>
      document.elements.map((element) => {
        const shape = elementShape(element, values);
        return { element, shape, bounds: elementBounds(element, shape) };
      }),
    [document, values],
  );

  const pointerMm = (event: ReactPointerEvent): Point => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
  };

  const startMove = (event: ReactPointerEvent, element: LabelElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    pointerFocus.current = true;
    const additive = event.shiftKey || event.metaKey;
    const alreadySelected = selectedIds.includes(element.id);
    if (!alreadySelected || additive) onSelect(element.id, additive);
    if (additive) return;
    const ids = alreadySelected ? selectedIds : [element.id];
    const box = union(placed.filter((item) => ids.includes(item.element.id)).map((item) => item.bounds));
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: "move", ids, origin: pointerMm(event), box, delta: { x: 0, y: 0 }, moved: false, guides: { x: [], y: [] } });
  };

  const startResize = (event: ReactPointerEvent, element: LabelElement) => {
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: "resize", id: element.id, origin: pointerMm(event), delta: { x: 0, y: 0 } });
  };

  const startMarquee = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const point = pointerMm(event);
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: "marquee", origin: point, current: point, additive: event.shiftKey || event.metaKey });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const point = pointerMm(event);
    const inside = point.x >= 0 && point.y >= 0 && point.x <= widthMm && point.y <= heightMm ? { x: round2(point.x), y: round2(point.y) } : null;
    setCursor(inside);
    onCursor?.(inside);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "marquee") return setDrag({ ...drag, current: point });
    const raw = { x: point.x - drag.origin.x, y: point.y - drag.origin.y };
    if (drag.kind === "resize") return setDrag({ ...drag, delta: raw });
    const others = placed.filter((item) => !drag.ids.includes(item.element.id)).map((item) => item.bounds);
    const targets = {
      x: [0, widthMm / 2, widthMm, ...others.flatMap((box) => [box.x, box.x + box.width / 2, box.x + box.width])],
      y: [0, heightMm / 2, heightMm, ...others.flatMap((box) => [box.y, box.y + box.height / 2, box.y + box.height])],
    };
    const smart = event.altKey ? { delta: raw, guides: { x: [], y: [] } } : smartSnap(drag.box, raw, targets, GUIDE_PX / scale);
    const delta = {
      x: smart.guides.x.length ? smart.delta.x : snap ? snapTo(drag.box.x + raw.x, SNAP_MM) - drag.box.x : raw.x,
      y: smart.guides.y.length ? smart.delta.y : snap ? snapTo(drag.box.y + raw.y, SNAP_MM) - drag.box.y : raw.y,
    };
    setDrag({ ...drag, delta: { x: round2(delta.x), y: round2(delta.y) }, guides: smart.guides, moved: drag.moved || Math.hypot(raw.x, raw.y) * scale > 3 });
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "move" && drag.moved) onMove(drag.ids, drag.delta.x, drag.delta.y);
    if (drag.kind === "resize") {
      const target = placed.find(({ element }) => element.id === drag.id);
      if (target) {
        const local = unrotate(target.element.rotation, drag.delta.x, drag.delta.y);
        const update = resizeUpdate(target.element, target.shape, local.x, local.y);
        if (update) onResize(drag.id, update);
      }
    }
    if (drag.kind === "marquee") {
      const area = union([
        { x: drag.origin.x, y: drag.origin.y, width: 0, height: 0 },
        { x: drag.current.x, y: drag.current.y, width: 0, height: 0 },
      ]);
      if (area.width * scale < 3 && area.height * scale < 3) {
        if (!drag.additive) onClear();
      } else {
        const hit = placed
          .filter(({ bounds }) => bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y)
          .map(({ element }) => element.id);
        onSelectMany(hit, drag.additive);
      }
    }
    setDrag(null);
  };

  const resizing = drag?.kind === "resize" ? placed.find(({ element }) => element.id === drag.id) : undefined;
  const resizePreview =
    resizing && drag?.kind === "resize"
      ? (() => {
          const local = unrotate(resizing.element.rotation, drag.delta.x, drag.delta.y);
          const update = resizeUpdate(resizing.element, resizing.shape, local.x, local.y);
          return update ? { id: resizing.element.id, shape: elementShape({ ...resizing.element, ...update }, values) } : undefined;
        })()
      : undefined;

  const handle = 10 / scale;
  const marquee = drag?.kind === "marquee" ? union([{ ...drag.origin, width: 0, height: 0 }, { ...drag.current, width: 0, height: 0 }]) : null;
  const guides = drag?.kind === "move" && drag.moved ? drag.guides : null;

  return (
    <div className="grid w-max" style={{ gridTemplateColumns: `${RULER_PX}px auto`, gridTemplateRows: `${RULER_PX}px auto` }}>
      <div aria-hidden="true" className="sticky top-0 left-0 z-20 border-r border-b border-border bg-card" />
      <div className="sticky top-0 z-10 border-b border-border bg-card">
        <Ruler lengthMm={widthMm} scale={scale} orientation="horizontal" cursor={cursor?.x} />
      </div>
      <div className="sticky left-0 z-10 border-r border-border bg-card">
        <Ruler lengthMm={heightMm} scale={scale} orientation="vertical" cursor={cursor?.y} />
      </div>
      <div style={{ padding: STAGE_PAD_PX }} onPointerDown={onClear}>
        <svg
          ref={svgRef}
          aria-label="Label canvas"
          role="group"
          width={widthMm * scale}
          height={heightMm * scale}
          viewBox={`0 0 ${widthMm} ${heightMm}`}
          className="block touch-none overflow-visible select-none"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => {
            setCursor(null);
            onCursor?.(null);
          }}
        >
          <defs>
            <pattern id="studio-grid-minor" width={1} height={1} patternUnits="userSpaceOnUse">
              <path d="M1 0V1H0" fill="none" stroke="#0c0c0e" strokeOpacity={0.06} strokeWidth={0.05} />
            </pattern>
            <pattern id="studio-grid-major" width={10} height={10} patternUnits="userSpaceOnUse">
              <rect width={10} height={10} fill="url(#studio-grid-minor)" />
              <path d="M10 0V10H0" fill="none" stroke="#0c0c0e" strokeOpacity={0.12} strokeWidth={0.08} />
            </pattern>
            <clipPath id="studio-label-clip">
              <rect width={widthMm} height={heightMm} rx={LABEL_RADIUS_MM} />
            </clipPath>
          </defs>
          <rect
            data-testid="label-stock"
            width={widthMm}
            height={heightMm}
            rx={LABEL_RADIUS_MM}
            fill="#ffffff"
            className="cursor-crosshair"
            style={{ filter: "drop-shadow(0 0.3px 0.4px rgb(12 12 14 / 0.12)) drop-shadow(0 1.6px 3px rgb(12 12 14 / 0.08))" }}
            onPointerDown={startMarquee}
          />
          {snap ? <rect width={widthMm} height={heightMm} fill="url(#studio-grid-major)" clipPath="url(#studio-label-clip)" pointerEvents="none" /> : null}

          {placed.map(({ element, shape: baseShape }) => {
            const selected = selectedIds.includes(element.id);
            const flagged = flaggedIds.has(element.id);
            const offset = drag?.kind === "move" && drag.ids.includes(element.id) ? drag.delta : { x: 0, y: 0 };
            const shape = resizePreview?.id === element.id ? resizePreview.shape : baseShape;
            const name = elementName(element);
            return (
              <g
                key={element.id}
                data-testid={`element-${element.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${name}, ${element.type}`}
                className="cursor-move outline-none [&:focus-visible>.studio-focus]:opacity-100"
                transform={elementTransform(element, offset)}
                onPointerDown={(event) => startMove(event, element)}
                onFocus={() => {
                  if (!pointerFocus.current && !selected) onSelect(element.id, false);
                  pointerFocus.current = false;
                }}
              >
                <rect className="studio-focus opacity-0" x={-0.8} y={-0.8} width={shape.widthMm + 1.6} height={shape.heightMm + 1.6} rx={0.6} fill="none" stroke="#0c0c0e" strokeWidth={0.35} />
                <rect x={-0.3} y={-0.3} width={shape.widthMm + 0.6} height={shape.heightMm + 0.6} fill="transparent" />
                {flagged ? (
                  <rect x={-0.4} y={-0.4} width={shape.widthMm + 0.8} height={shape.heightMm + 0.8} fill={WARN} fillOpacity={0.12} stroke={WARN} strokeWidth={0.25} strokeDasharray="0.8 0.5" />
                ) : null}
                <ElementArtwork element={element} shape={shape} editing />
                {selected ? (
                  <rect x={-0.4} y={-0.4} width={shape.widthMm + 0.8} height={shape.heightMm + 0.8} fill={SELECT} fillOpacity={0.06} stroke={SELECT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                ) : null}
                {selected && selectedIds.length === 1 ? (
                  <rect
                    data-testid="resize-handle"
                    aria-hidden="true"
                    x={shape.widthMm + 0.4 - handle / 2}
                    y={shape.heightMm + 0.4 - handle / 2}
                    width={handle}
                    height={handle}
                    rx={handle / 4}
                    fill="#ffffff"
                    stroke={SELECT}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-nwse-resize"
                    onPointerDown={(event) => startResize(event, element)}
                  />
                ) : null}
              </g>
            );
          })}

          {guides
            ? [
                ...guides.x.map((x) => <line key={`gx${x}`} x1={x} x2={x} y1={-2} y2={heightMm + 2} stroke={GUIDE} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />),
                ...guides.y.map((y) => <line key={`gy${y}`} y1={y} y2={y} x1={-2} x2={widthMm + 2} stroke={GUIDE} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />),
              ]
            : null}
          {marquee ? (
            <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill={SELECT} fillOpacity={0.08} stroke={SELECT} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ) : null}
        </svg>
      </div>
    </div>
  );
}
