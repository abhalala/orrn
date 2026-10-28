import { useEffect, useId, useRef, useState } from "react";

export const PROCESS_STAGES = ["scrap", "cast", "die", "press", "age", "pack", "dispatch"] as const;
export type ProcessStage = (typeof PROCESS_STAGES)[number];

export type BrandTone = "amber" | "red" | "blue" | "green";

/**
 * Each stage along the 7-step chain lights up with one of the four ORRN brand
 * tones (matching the 4 tiles of OrrnMark in orrn-showcase).
 */
export const STAGE_TONE: Record<ProcessStage, BrandTone> = {
  scrap: "amber",
  cast: "red",
  die: "blue",
  press: "amber",
  age: "red",
  pack: "green",
  dispatch: "blue",
};

export type KeyMark = "raised" | "flat" | "lit" | "dim" | "red" | "green" | "blue";

type FigureLayer = { kind: "static"; svg: string } | { kind: "move"; id: string; svg: string };

type FigureJson = {
  name: string;
  width: number;
  height: number;
  css: string;
  layers: FigureLayer[];
  axes: Record<string, [number, number]>;
  meta: Record<string, unknown>;
};

type LayerPose = {
  t?: number;
  rotate?: number;
  origin?: [number, number];
  opacity?: number;
};

type FigurePose = Record<string, LayerPose>;

type FigureName = "weighbridge" | "furnace" | "dieroom" | "press" | "pack" | "dispatch";

const figureCache = new Map<FigureName, FigureJson>();
const figurePromises = new Map<FigureName, Promise<FigureJson>>();

function loadFigure(name: FigureName): Promise<FigureJson> {
  const cached = figureCache.get(name);
  if (cached) return Promise.resolve(cached);
  const inflight = figurePromises.get(name);
  if (inflight) return inflight;
  const req = fetch(`/figures/${name}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load figure ${name}`);
      return res.json() as Promise<FigureJson>;
    })
    .then((json) => {
      figureCache.set(name, json);
      return json;
    })
    .catch((error: unknown) => {
      figurePromises.delete(name);
      throw error;
    });
  figurePromises.set(name, req);
  return req;
}

function useFigure(name: FigureName, enabled = true): FigureJson | null {
  const [fig, setFig] = useState<FigureJson | null>(() => figureCache.get(name) ?? null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const cached = figureCache.get(name);
    if (cached) {
      setFig(cached);
      return;
    }
    loadFigure(name)
      .then((loaded) => {
        if (active) setFig(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [name, enabled]);
  return fig?.name === name ? fig : null;
}

const fine = (v: number) => Math.round(v * 1000) / 1000;

export function layerTransform(
  axis: [number, number] | undefined,
  pose: LayerPose | undefined,
): string | undefined {
  if (!pose) return undefined;
  const parts: string[] = [];
  if (axis && pose.t) parts.push(`translate(${fine(axis[0] * pose.t)} ${fine(axis[1] * pose.t)})`);
  if (pose.rotate) {
    const [ox, oy] = pose.origin ?? [0, 0];
    parts.push(`rotate(${fine(pose.rotate)} ${fine(ox)} ${fine(oy)})`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

/** Scope SVG internal IDs (e.g. clipPath/radialGradient in press.json & furnace.json) per instance. */
function scopeSvgIds(svg: string, uid: string): string {
  return svg
    .replace(/\bid="((?:pr|fu)-[^"]+)"/g, `id="${uid}-$1"`)
    .replace(/url\(#((?:pr|fu)-[^)]+)\)/g, `url(#${uid}-$1)`);
}

/**
 * 3D isometric legend swatch from orrn-showcase/figures/kit/kit/react/draw.tsx.
 */
export function Swatch({ mark }: { mark: KeyMark }) {
  if (mark === "raised" || mark === "flat" || mark === "lit") {
    return (
      <svg className="iso-swatch" data-mark={mark} viewBox="0 0 16 10" aria-hidden="true" focusable="false">
        <path d={mark === "flat" ? "M2 6.5 8 3.5 14 6.5 8 9.5Z" : "M2 4.5 8 1.5 14 4.5 14 6 8 9 2 6Z"} />
        {mark === "flat" ? null : <path className="iso-swatch-crease" d="M2 4.5 8 7.5 14 4.5" />}
      </svg>
    );
  }
  return (
    <svg className="iso-swatch" data-mark={mark} viewBox="0 0 16 10" aria-hidden="true" focusable="false">
      <path d="M1.5 5h13" />
    </svg>
  );
}

/**
 * Computes the press & ageing oven pose using the exact kinematics from
 * orrn-showcase/src/scenes/plant/poses.ts (R33: the ram drives the profile).
 */
export type PressPoseMode = "charge" | "press" | "age";

export function computePressPose(mode: PressPoseMode): {
  pose: FigurePose;
  ram: number;
  billet: number;
  profile: number;
  trolley: number;
} {
  const presets = {
    charge: { ram: 24, billet: 20, profile: 0, trolley: 0, door: 0 },
    press: { ram: 80, billet: 50, profile: 203, trolley: 18, door: 0 },
    age: { ram: 80, billet: 50, profile: 203, trolley: 44, door: 64 },
  } as const;
  const p = presets[mode];
  const segment = 29;
  const pose: FigurePose = {
    ram: { t: p.ram },
    billet: { t: p.billet },
    profile: { t: p.profile },
    trolley: { t: p.trolley },
    "oven-door": { t: p.door },
  };
  for (let i = 0; i < 8; i++) {
    const id = `profile-${i + 1}`;
    const start = i * segment;
    const opacity = p.profile <= 0 ? 0 : p.profile >= start ? 1 : Math.max(0, (p.profile - (start - 3)) / 3);
    pose[id] = { opacity };
  }
  return { pose, ram: p.ram, billet: p.billet, profile: p.profile, trolley: p.trolley };
}

/**
 * Poses for each of the 7 stages in the chain, matching orrn-showcase Chapter 9.
 */
function stageFigureAndPose(stage: ProcessStage): { figureName: FigureName; pose: FigurePose } {
  switch (stage) {
    case "scrap":
      return {
        figureName: "weighbridge",
        pose: {
          truck: { t: 0 },
          numerals: { opacity: 1 },
          "needle-party": { rotate: 144, origin: [507.349, 188.582] },
          "needle-ours": { rotate: 133.2, origin: [507.321, 188.582] },
          "gap-arc": { opacity: 1 },
        },
      };
    case "cast":
      return {
        figureName: "furnace",
        pose: {
          door: { t: 26 },
          charge: { t: 0, opacity: 1 },
          glow: { opacity: 1 },
          logs: { t: 0, opacity: 1 },
          dross: { opacity: 1 },
        },
      };
    case "die":
      return {
        figureName: "dieroom",
        pose: {
          copy: { t: 0 },
          band: { opacity: 1 },
          piece: { t: 0 },
          needle: { rotate: 37.125, origin: [525.955, 227.554] },
        },
      };
    case "press":
      return {
        figureName: "press",
        pose: computePressPose("press").pose,
      };
    case "age":
      return {
        figureName: "press",
        pose: computePressPose("age").pose,
      };
    case "pack":
      return {
        figureName: "pack",
        pose: {
          bundle: { t: 0 },
          sticker: { t: 10 },
        },
      };
    case "dispatch":
      return {
        figureName: "dispatch",
        pose: {
          truck: { t: 0 },
          beam: { opacity: 1 },
        },
      };
  }
}

/**
 * Synchronous isometric blueprint fallback while the figure JSON resolves.
 */
function BlueprintFallback({
  width = 640,
  height = 320,
  extraProps,
}: {
  width?: number;
  height?: number;
  extraProps?: Record<string, string>;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      focusable="false"
      className="iso iso-svg marketing-extrusion"
      {...extraProps}
    >
      <g stroke="var(--border)" strokeWidth="0.8">
        <path d="M56 238 308 112 584 226 332 308Z" fill="#131316" />
        <path d="M126 196 276 122 498 206 348 282Z" fill="#18181c" stroke="var(--input)" />
        <path d="M168 176 268 128 364 166 264 214Z" fill="#1f1f24" stroke="var(--foreground)" strokeOpacity="0.45" />
        <path d="M294 176 516 258" stroke="var(--tone-amber-from)" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/**
 * Renders an orrn-showcase FigureJson as an isometric technical SVG.
 */
function IsoFigureSvg({
  figure,
  pose,
  extraProps,
}: {
  figure: FigureJson;
  pose: FigurePose;
  extraProps?: Record<string, string>;
}) {
  const rawId = useId().replace(/:/g, "");
  return (
    <svg
      key={figure.name}
      className="iso iso-svg marketing-extrusion"
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      focusable="false"
      {...extraProps}
    >
      <style>{figure.css}</style>
      {figure.layers.map((layer, index) => {
        const scoped = scopeSvgIds(layer.svg, rawId);
        if (layer.kind === "static") {
          return <g key={index} dangerouslySetInnerHTML={{ __html: scoped }} />;
        }
        const p = pose[layer.id];
        const opacity = p?.opacity;
        return (
          <g
            key={index}
            data-part={layer.id}
            transform={layerTransform(figure.axes[layer.id], p)}
            opacity={opacity === undefined ? undefined : Math.max(0, Math.min(1, opacity))}
            dangerouslySetInnerHTML={{ __html: scoped }}
          />
        );
      })}
    </svg>
  );
}

/**
 * Hero centerpiece: The F4 Extrusion Press & Ageing Oven anatomy figure from
 * orrn-showcase, framed inside an iso-plate with interactive pose controls.
 */
export function ExtrusionArt({
  poseMode = "press",
}: {
  poseMode?: PressPoseMode;
}) {
  const figure = useFigure("press");
  const { pose } = computePressPose(poseMode);
  if (!figure) {
    return <BlueprintFallback width={640} height={320} extraProps={{ "data-extrusion-art": "" }} />;
  }
  return (
    <IsoFigureSvg
      figure={figure}
      pose={pose}
      extraProps={{ "data-extrusion-art": "", "data-pose-mode": poseMode }}
    />
  );
}

function restingPose(figure: FigureJson, activePose: FigurePose): FigurePose {
  const pose = { ...activePose };
  for (const layer of figure.layers) {
    if (layer.kind === "move") pose[layer.id] = { ...activePose[layer.id], t: 0, opacity: 0 };
  }
  return pose;
}

/**
 * Stage plate artwork for each of the 7 extrusion stages in #flow.
 */
export function ProcessArt({ stage }: { stage: ProcessStage }) {
  const root = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [enteredName, setEnteredName] = useState<FigureName | null>(null);
  const { figureName, pose } = stageFigureAndPose(stage);
  const figure = useFigure(figureName, nearViewport);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!figure || !nearViewport) return;
    const frame = requestAnimationFrame(() => setEnteredName(figureName));
    return () => cancelAnimationFrame(frame);
  }, [figure, figureName, nearViewport]);

  return (
    <div ref={root}>
      {figure ? (
        <IsoFigureSvg
          figure={figure}
          pose={enteredName === figureName ? pose : restingPose(figure, pose)}
          extraProps={{ "data-process-art": "", "data-stage": stage, "data-loaded": "true" }}
        />
      ) : (
        <BlueprintFallback
          width={640}
          height={340}
          extraProps={{ "data-process-art": "", "data-stage": stage }}
        />
      )}
    </div>
  );
}
