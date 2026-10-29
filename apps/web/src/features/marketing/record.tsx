import { useT } from "@orrn/i18n";
import type { CSSProperties } from "react";

import { seeded } from "./bundle-label";

type Square = { x: number; y: number; tone: "a" | "b" | "core" | "out"; at: number };
type Shape = { squares: Square[]; width: number; height: number };

const SIZE = 12;

/**
 * Loose squares (the plant's separate registers) pressed into a three-square
 * ribbon (one record), then laid out in even rows (packing lists, recovery,
 * stock). `at` is how far along the flow a square sits, 0 to 1, for its
 * entrance delay. Horizontal on wide screens, top to bottom on phones.
 */
function layout(direction: "across" | "down"): Shape {
  const rnd = seeded(`orrn:${direction}`);
  const across = direction === "across";
  const [width, height] = across ? [1200, 270] : [300, 400];
  const along = across ? width : height;
  const cross = across ? height : width;
  const third = along / 3;
  const place = (a: number, c: number, tone: Square["tone"]): Square => ({
    x: across ? a : c,
    y: across ? c : a,
    tone,
    at: a / along,
  });
  const squares: Square[] = [];

  const loose = across ? 40 : 30;
  for (let i = 0; i < loose; i++) {
    squares.push(place(rnd() * (third - SIZE * 2), 6 + rnd() * (cross - SIZE - 12), i % 3 === 0 ? "b" : "a"));
  }

  const step = SIZE + 2;
  const ribbonStart = third + step;
  const ribbonCells = Math.floor((third - step * 2) / step);
  const ribbonTop = cross / 2 - (step * 3 - 2) / 2;
  for (let i = 0; i < ribbonCells; i++) {
    for (let row = 0; row < 3; row++) squares.push(place(ribbonStart + i * step, ribbonTop + row * step, "core"));
  }

  // Out: bundles, each a 2×2 block of squares like the orrn mark, in even rows.
  const [cols, rows] = across ? [6, 4] : [3, 3];
  const block = step * 2;
  const outStart = third * 2 + step * 2;
  const outStep = (third - step * 2 - block) / (cols - 1);
  const rowStep = (cross - block - 24) / (rows - 1);
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const a = outStart + col * outStep;
      const c = 12 + row * rowStep;
      for (const [da, dc] of [[0, 0], [step, 0], [0, step], [step, step]] as const) squares.push(place(a + da, c + dc, "out"));
    }
  }
  return { squares, width, height };
}

const ACROSS = layout("across");
const DOWN = layout("down");

function Diagram({ shape, className }: { shape: Shape; className: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true" focusable="false">
      {shape.squares.map((square, index) => (
        <rect
          // Squares never reorder; the index is their identity.
          key={index}
          x={square.x}
          y={square.y}
          width={SIZE}
          height={SIZE}
          data-tone={square.tone}
          style={{ "--at": square.at.toFixed(3) } as CSSProperties}
        />
      ))}
    </svg>
  );
}

export function ManyIntoOne() {
  const { t } = useT();
  const parts = [
    { name: t("marketing.record.inName"), body: t("marketing.record.inBody") },
    { name: t("marketing.record.coreName"), body: t("marketing.record.coreBody") },
    { name: t("marketing.record.outName"), body: t("marketing.record.outBody") },
  ];
  return (
    <section id="record" className="marketing-record" aria-labelledby="record-title">
      <div className="marketing-record-head" data-reveal>
        <h2 id="record-title" className="marketing-heading">
          {t("marketing.record.title")}
        </h2>
        <p className="marketing-lead">{t("marketing.record.body")}</p>
      </div>
      <div className="marketing-record-flow" data-reveal>
        <Diagram shape={ACROSS} className="marketing-diagram marketing-diagram-across" />
        <Diagram shape={DOWN} className="marketing-diagram marketing-diagram-down" />
        <ol role="list" className="marketing-record-parts">
          {parts.map((part) => (
            <li key={part.name}>
              <h3>{part.name}</h3>
              <p>{part.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
