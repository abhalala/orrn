import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Camera, ImagePlus, ShieldCheck } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { scaledCanvas, warpPixels, type Pixels, type Point, type Quad } from "./label-photo-geometry";

/** Largest photo file accepted. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
/** Photos are worked on at most this many pixels on their longer side. */
const WORKING_SIDE = 2400;

export type PhotoProblem = "tooLarge" | "heic" | "unreadable";

/** Decodes a picked photo (upright, per its EXIF orientation) into a working canvas. */
export async function readPhotoFile(file: File): Promise<{ canvas: HTMLCanvasElement } | { problem: PhotoProblem }> {
  if (file.size > MAX_PHOTO_BYTES) return { problem: "tooLarge" };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = scaledCanvas(bitmap, WORKING_SIDE);
    bitmap.close();
    return { canvas };
  } catch {
    return { problem: /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name) ? "heic" : "unreadable" };
  }
}

/**
 * Drop zone and pickers for a label photo. "Take a photo" opens the rear camera on phones and
 * tablets (`capture="environment"`); "Choose a photo" opens the library or the file system.
 */
export function PhotoPicker({ onFile, problem, busy }: { onFile: (file: File) => void; problem: PhotoProblem | null; busy?: boolean }) {
  const { t } = useT();
  const chooseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const errorId = useId();
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (!busy) pick(event.dataTransfer.files);
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        data-testid="photo-drop"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={onDrop}
        className={cn(
          "flex min-w-0 flex-col items-center gap-3 rounded-card border-2 border-dashed border-input bg-surface-sunken px-4 py-8 text-center transition-colors",
          dragOver && "border-foreground bg-accent",
        )}
      >
        <ImagePlus aria-hidden="true" className="size-8 text-muted-foreground" strokeWidth={1.75} />
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[15px] font-semibold leading-6">{t("printing.library.photo.dropTitle")}</p>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("printing.library.photo.dropHint")}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" loading={busy} onPress={() => chooseRef.current?.click()} aria-describedby={problem ? errorId : undefined}>
            {t("printing.library.photo.choose")}
          </Button>
          <Button variant="secondary" className="hidden pointer-coarse:inline-flex" disabled={busy} onPress={() => cameraRef.current?.click()}>
            <Camera aria-hidden="true" /> {t("printing.library.photo.takePhoto")}
          </Button>
        </div>
        <input
          ref={chooseRef}
          data-testid="photo-input"
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {problem ? (
        <p id={errorId} role="alert" className="m-0 text-[14px] font-medium leading-5 text-destructive">
          {t(`printing.library.photo.${problem}`)}
        </p>
      ) : null}
      <p className="m-0 flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{t("printing.library.photo.privacy")}</span>
      </p>
    </div>
  );
}

/** Draws a canvas into a visible one that scales with its box. */
export function CanvasView({ source, className, label }: { source: HTMLCanvasElement; className?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const target = ref.current;
    if (!target) return;
    target.width = source.width;
    target.height = source.height;
    target.getContext("2d")!.drawImage(source, 0, 0);
  }, [source]);
  return <canvas ref={ref} role="img" aria-label={label} className={cn("block h-auto w-full", className)} />;
}

const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

/**
 * The photo with a draggable four-corner crop. Corners are dragged with a pointer or moved with
 * the arrow keys (Shift for bigger steps); the edge between the first two corners is drawn thick,
 * it becomes the top of the straightened label.
 */
export function CropEditor({ source, quad, onChange }: { source: HTMLCanvasElement; quad: Quad; onChange: (quad: Quad) => void }) {
  const { t } = useT();
  const hintId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const { width, height } = source;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => setDisplayWidth(svg.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Screen pixels to photo pixels, so handles keep their on-screen size.
  const unit = displayWidth > 0 ? width / displayWidth : width / 600;
  const clampPoint = (point: Point): Point => ({ x: Math.min(width, Math.max(0, point.x)), y: Math.min(height, Math.max(0, point.y)) });
  const move = (index: number, point: Point) => {
    const next = [...quad] as Quad;
    next[index] = clampPoint(point);
    onChange(next);
  };
  const toPhoto = (event: ReactPointerEvent): Point => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * width, y: ((event.clientY - box.top) / box.height) * height };
  };
  const onKeyDown = (event: KeyboardEvent<SVGGElement>, index: number) => {
    const step = (event.shiftKey ? 0.05 : 0.005) * Math.max(width, height);
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    move(index, { x: quad[index]!.x + dx, y: quad[index]!.y + dy });
  };
  const outline = quad.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="relative min-w-0 overflow-hidden rounded-input bg-surface-sunken">
      <CanvasView source={source} label={t("printing.library.photo.photoAlt")} />
      <p id={hintId} className="sr-only">
        {t("printing.library.photo.cornerHint")}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full touch-none select-none"
        onPointerMove={(event) => {
          if (dragging !== null) move(dragging, toPhoto(event));
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        <path d={`M0 0H${width}V${height}H0Z M${outline.replaceAll(" ", " L")}Z`} fillRule="evenodd" fill="#0c0c0e" fillOpacity={0.45} pointerEvents="none" />
        <polygon points={outline} fill="none" stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <line x1={quad[0].x} y1={quad[0].y} x2={quad[1].x} y2={quad[1].y} stroke="#ffffff" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {quad.map((point, index) => (
          <g
            key={CORNERS[index]}
            role="button"
            tabIndex={0}
            aria-label={t(`printing.library.photo.corners.${CORNERS[index]!}`)}
            aria-describedby={hintId}
            data-testid={`crop-${CORNERS[index]}`}
            className="cursor-grab outline-none [&:focus-visible>.crop-focus]:opacity-100"
            onKeyDown={(event) => onKeyDown(event, index)}
            onPointerDown={(event) => {
              event.preventDefault();
              svgRef.current?.setPointerCapture(event.pointerId);
              setDragging(index);
            }}
          >
            {/* 44 px touch target around a 12 px handle. */}
            <circle cx={point.x} cy={point.y} r={22 * unit} fill="transparent" />
            <circle className="crop-focus opacity-0" cx={point.x} cy={point.y} r={15 * unit} fill="none" stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <circle cx={point.x} cy={point.y} r={9 * unit} fill="#ffffff" stroke="#0c0c0e" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** A live, small straightened copy of the crop: shows the turn and the stock aspect before reading. */
export function StraightenedPreview({ pixels, quad, aspect, label }: { pixels: Pixels; quad: Quad; aspect: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = 360;
  const height = Math.max(1, Math.round(width / aspect));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const frame = requestAnimationFrame(() => {
      try {
        const data = warpPixels(pixels, quad, width, height);
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.putImageData(new ImageData(data, width, height), 0, 0);
      } catch {
        // Corners on one line: keep the last preview.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pixels, quad, height]);
  return <canvas ref={ref} role="img" aria-label={label} className="block h-auto w-full rounded-[3px] bg-white ring-1 ring-black/10" style={{ aspectRatio: `${width} / ${height}` }} />;
}
