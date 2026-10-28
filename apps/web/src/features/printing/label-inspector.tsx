import type { LabelDocument, LabelElement, LabelPage, LabelVariable } from "@orrn/domain";
import { Input } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useId, useState, type ReactNode } from "react";

import { FIELD_CATALOG, VARIABLE_LABELS, dots, elementName, elementShape, mmFromDots, round2, type LabelValues } from "./label-metrics";

function Row({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 text-xs leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Number field that commits on blur or Enter (one undo step per edit) and follows outside changes. */
function NumberInput({ id, value, step, min, max, onCommit }: { id: string; value: number | undefined; step: number; min?: number; max?: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const next = Number(text);
    if (text.trim() === "" || !Number.isFinite(next)) return setText(value === undefined ? "" : String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
    if (clamped !== value) onCommit(round2(clamped));
    else setText(String(value));
  };
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      value={text}
      className="h-10 font-mono tabular-nums"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="m-0 text-[13px] font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

const ROTATIONS: LabelElement["rotation"][] = [0, 90, 180, 270];
const SYMBOLOGIES = [
  ["128", "Code 128"],
  ["39", "Code 39"],
  ["93", "Code 93"],
  ["EAN13", "EAN-13"],
  ["EAN8", "EAN-8"],
  ["UPCA", "UPC-A"],
  ["UPCE", "UPC-E"],
  ["I2OF5", "Interleaved 2 of 5"],
  ["CODABAR", "Codabar"],
  ["MSI", "MSI"],
] as const;

function SourceField({ element, values, onChange }: { element: LabelElement; values: LabelValues; onChange: (update: Partial<LabelElement>) => void }) {
  const id = useId();
  const isStatic = !element.variable;
  return (
    <>
      <Row label="Prints" htmlFor={`${id}-source`}>
        <NativeSelect
          id={`${id}-source`}
          density="compact"
          value={element.variable ?? "__static"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "__static") onChange({ variable: undefined, content: element.content || "Text" });
            else onChange({ variable: value as LabelVariable, content: undefined });
          }}
        >
          {element.type === "text" ? <option value="__static">Fixed text</option> : null}
          {FIELD_CATALOG.map((variable) => (
            <option key={variable} value={variable}>
              {VARIABLE_LABELS[variable]}
            </option>
          ))}
        </NativeSelect>
      </Row>
      {isStatic && element.type === "text" ? (
        <Row label="Text" htmlFor={`${id}-content`} hint="Fields inserted here print as that bundle's value.">
          <TextCommitInput id={`${id}-content`} value={element.content ?? ""} onCommit={(content) => onChange({ content })} />
          <NativeSelect
            aria-label="Insert a field into the text"
            density="compact"
            value=""
            onChange={(event) => {
              if (event.target.value) onChange({ content: `${element.content ?? ""}{{${event.target.value}}}` });
            }}
          >
            <option value="">Insert a field</option>
            {FIELD_CATALOG.map((variable) => (
              <option key={variable} value={variable}>
                {VARIABLE_LABELS[variable]}
              </option>
            ))}
          </NativeSelect>
        </Row>
      ) : (
        <p className="m-0 rounded-input bg-surface-sunken px-3 py-2 font-mono text-[13px] break-all text-foreground" aria-label="Sample value">
          {element.variable ? values[element.variable] || "(empty for this bundle)" : ""}
        </p>
      )}
    </>
  );
}

/** Common TA220 roll sizes; the first is the plant's current bundle label. */
const STOCK_SIZES = [
  { label: "102.25 × 76.2 mm (4 × 3 in)", widthMm: 102.25, heightMm: 76.2 },
  { label: "100 × 75 mm", widthMm: 100, heightMm: 75 },
  { label: "100 × 50 mm", widthMm: 100, heightMm: 50 },
  { label: "101.6 × 152.4 mm (4 × 6 in)", widthMm: 101.6, heightMm: 152.4 },
  { label: "76.2 × 50.8 mm (3 × 2 in)", widthMm: 76.2, heightMm: 50.8 },
  { label: "50 × 25 mm", widthMm: 50, heightMm: 25 },
  { label: "38 × 25 mm", widthMm: 38, heightMm: 25 },
] as const;

function TextCommitInput({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value && text.length > 0) onCommit(text);
    else setText(value);
  };
  return (
    <Input
      id={id}
      value={text}
      className="h-10"
      maxLength={120}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

export function ElementInspector({ element, values, onChange }: { element: LabelElement; values: LabelValues; onChange: (update: Partial<LabelElement>) => void }) {
  const id = useId();
  const shape = elementShape(element, values);
  return (
    <div className="flex flex-col gap-4" aria-label="Element inspector">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="m-0 truncate text-[15px] font-semibold">{elementName(element)}</p>
        <p className="m-0 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {round2(shape.widthMm)} × {round2(shape.heightMm)} mm
        </p>
      </div>

      {element.type === "text" || element.type === "barcode" || element.type === "qrcode" || element.type === "datamatrix" || element.type === "pdf417" ? (
        <Section title="Content">
          <SourceField element={element} values={values} onChange={onChange} />
        </Section>
      ) : null}

      <Section title="Position">
        <div className="grid grid-cols-2 gap-3">
          <Row label="X (mm)" htmlFor={`${id}-x`}>
            <NumberInput id={`${id}-x`} value={element.xMm} step={0.25} onCommit={(xMm) => onChange({ xMm })} />
          </Row>
          <Row label="Y (mm)" htmlFor={`${id}-y`}>
            <NumberInput id={`${id}-y`} value={element.yMm} step={0.25} onCommit={(yMm) => onChange({ yMm })} />
          </Row>
        </div>
        <Row label="Rotation" htmlFor={`${id}-rotation`}>
          <NativeSelect id={`${id}-rotation`} density="compact" value={element.rotation} onChange={(event) => onChange({ rotation: Number(event.target.value) as LabelElement["rotation"] })}>
            {ROTATIONS.map((rotation) => (
              <option key={rotation} value={rotation}>
                {rotation}°
              </option>
            ))}
          </NativeSelect>
        </Row>
      </Section>

      {element.type === "text" ? (
        <Section title="Type">
          <Row label="Size" htmlFor={`${id}-size`} hint="The printer's font 3 prints in whole steps of 3 mm.">
            <NativeSelect id={`${id}-size`} density="compact" value={Math.max(1, Math.floor((element.fontSizeMm ?? 3) / 3 + 0.5))} onChange={(event) => onChange({ fontSizeMm: Number(event.target.value) * 3 })}>
              {[1, 2, 3, 4, 5, 6].map((scale) => (
                <option key={scale} value={scale}>
                  {scale * 3} mm tall ({scale === 1 ? "standard" : `${scale}× size`})
                </option>
              ))}
            </NativeSelect>
          </Row>
        </Section>
      ) : null}

      {element.type === "barcode" ? (
        <Section title="Barcode">
          <Row label="Symbology" htmlFor={`${id}-symbology`}>
            <NativeSelect id={`${id}-symbology`} density="compact" value={element.symbology ?? "128"} onChange={(event) => onChange({ symbology: event.target.value })}>
              {SYMBOLOGIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Bar height (mm)" htmlFor={`${id}-height`}>
              <NumberInput id={`${id}-height`} value={element.heightMm} step={0.5} min={3} onCommit={(heightMm) => onChange({ heightMm })} />
            </Row>
            <Row label="Bar width (dots)" htmlFor={`${id}-narrow`}>
              <NumberInput id={`${id}-narrow`} value={element.narrow} step={1} min={1} max={10} onCommit={(narrow) => onChange({ narrow, wide: Math.max(element.wide ?? narrow, narrow) })} />
            </Row>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-[15px]">
            <input type="checkbox" className="size-5 accent-[var(--foreground)]" checked={element.humanReadable ?? false} onChange={(event) => onChange({ humanReadable: event.target.checked })} />
            Print the number under the bars
          </label>
        </Section>
      ) : null}

      {element.type === "qrcode" ? (
        <Section title="QR code">
          <div className="grid grid-cols-2 gap-3">
            <Row label="Error correction" htmlFor={`${id}-level`}>
              <NativeSelect id={`${id}-level`} density="compact" value={element.level ?? "M"} onChange={(event) => onChange({ level: event.target.value as LabelElement["level"] })}>
                <option value="L">L (7%)</option>
                <option value="M">M (15%)</option>
                <option value="Q">Q (25%)</option>
                <option value="H">H (30%)</option>
              </NativeSelect>
            </Row>
            <Row label="Cell (dots)" htmlFor={`${id}-cell`}>
              <NativeSelect id={`${id}-cell`} density="compact" value={dots(element.cellMm ?? 1)} onChange={(event) => onChange({ cellMm: round2(mmFromDots(Number(event.target.value))) })}>
                {[3, 4, 5, 6, 7, 8, 10, 12].map((cell) => (
                  <option key={cell} value={cell}>
                    {cell} dots, {round2(mmFromDots(cell))} mm
                  </option>
                ))}
              </NativeSelect>
            </Row>
          </div>
        </Section>
      ) : null}

      {element.type === "pdf417" || element.type === "datamatrix" ? (
        <Section title={element.type === "pdf417" ? "PDF417" : "Data Matrix"}>
          <p className="m-0 text-xs leading-4 text-muted-foreground">The printer draws this symbol; the preview shows its reserved area only.</p>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Module (mm)" htmlFor={`${id}-module`}>
              <NumberInput id={`${id}-module`} value={element.moduleMm} step={0.125} min={0.125} onCommit={(moduleMm) => onChange({ moduleMm })} />
            </Row>
            {element.type === "pdf417" ? (
              <>
                <Row label="Columns" htmlFor={`${id}-columns`}>
                  <NumberInput id={`${id}-columns`} value={element.columns} step={1} min={1} max={30} onCommit={(columns) => onChange({ columns: Math.round(columns) })} />
                </Row>
                <Row label="Security level" htmlFor={`${id}-security`}>
                  <NumberInput id={`${id}-security`} value={element.security} step={1} min={0} max={8} onCommit={(security) => onChange({ security: Math.round(security) })} />
                </Row>
              </>
            ) : null}
          </div>
        </Section>
      ) : null}

      {element.type === "barcode" || element.type === "qrcode" || element.type === "datamatrix" || element.type === "pdf417" ? (
        <Row label="Quiet zone (mm)" htmlFor={`${id}-quiet`} hint="Clear space the scanner needs around the code.">
          <NumberInput id={`${id}-quiet`} value={element.quietZoneMm} step={0.5} min={0} onCommit={(quietZoneMm) => onChange({ quietZoneMm })} />
        </Row>
      ) : null}

      {element.type === "line" || element.type === "box" || element.type === "datamatrix" || element.type === "pdf417" ? (
        <Section title="Size">
          <div className="grid grid-cols-2 gap-3">
            <Row label="Width (mm)" htmlFor={`${id}-width`}>
              <NumberInput id={`${id}-width`} value={element.widthMm} step={0.25} min={0.25} onCommit={(widthMm) => onChange({ widthMm })} />
            </Row>
            <Row label="Height (mm)" htmlFor={`${id}-h`}>
              <NumberInput id={`${id}-h`} value={element.heightMm} step={0.25} min={0.25} onCommit={(heightMm) => onChange({ heightMm })} />
            </Row>
            {element.type === "line" || element.type === "box" ? (
              <Row label="Stroke (mm)" htmlFor={`${id}-stroke`}>
                <NumberInput id={`${id}-stroke`} value={element.strokeMm} step={0.25} min={0.25} onCommit={(strokeMm) => onChange({ strokeMm })} />
              </Row>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

export function PageInspector({ page, onChange }: { page: LabelDocument["page"]; onChange: (update: Partial<LabelPage>) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4" aria-label="Label stock">
      <Row label="Label stock" htmlFor={`${id}-stock`}>
        <NativeSelect
          id={`${id}-stock`}
          density="compact"
          value={STOCK_SIZES.find((size) => size.widthMm === page.widthMm && size.heightMm === page.heightMm)?.label ?? "custom"}
          onChange={(event) => {
            const size = STOCK_SIZES.find((option) => option.label === event.target.value);
            if (size) onChange({ widthMm: size.widthMm, heightMm: size.heightMm });
          }}
        >
          {STOCK_SIZES.map((size) => (
            <option key={size.label} value={size.label}>
              {size.label}
            </option>
          ))}
          <option value="custom">Custom size</option>
        </NativeSelect>
      </Row>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Width (mm)" htmlFor={`${id}-w`}>
          <NumberInput id={`${id}-w`} value={page.widthMm} step={0.25} min={5} max={112} onCommit={(widthMm) => onChange({ widthMm })} />
        </Row>
        <Row label="Height (mm)" htmlFor={`${id}-h`}>
          <NumberInput id={`${id}-h`} value={page.heightMm} step={0.25} min={5} onCommit={(heightMm) => onChange({ heightMm })} />
        </Row>
        <Row label="Gap (mm)" htmlFor={`${id}-gap`}>
          <NumberInput id={`${id}-gap`} value={page.gapMm} step={0.25} min={0} max={50} onCommit={(gapMm) => onChange({ gapMm })} />
        </Row>
        <Row label="Density" htmlFor={`${id}-density`}>
          <NumberInput id={`${id}-density`} value={page.density} step={1} min={0} max={15} onCommit={(density) => onChange({ density: Math.round(density) })} />
        </Row>
        <Row label="Speed" htmlFor={`${id}-speed`}>
          <NativeSelect id={`${id}-speed`} density="compact" value={page.speedInSec} onChange={(event) => onChange({ speedInSec: Number(event.target.value) as LabelPage["speedInSec"] })}>
            {[2, 3, 4, 5, 6].map((speed) => (
              <option key={speed} value={speed}>
                {speed} in/s
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label="Feed direction" htmlFor={`${id}-direction`}>
          <NativeSelect id={`${id}-direction`} density="compact" value={page.direction} onChange={(event) => onChange({ direction: Number(event.target.value) as LabelPage["direction"] })}>
            <option value={0}>Normal</option>
            <option value={1}>Reversed</option>
          </NativeSelect>
        </Row>
      </div>
      <p className="m-0 text-xs leading-4 text-muted-foreground">TE200/TA220 at 203 dpi. Media 5 to 112 mm wide.</p>
    </div>
  );
}
