import { te200Profile, validateLabelDocument, type LabelDocument, type LabelVariable } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { TextInput } from "@orrn/ui/components/field";
import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, ArrowLeft, Barcode, QrCode, RotateCcw, RotateCw, ScanSearch, Type } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { LabelPreview } from "./label-artwork";
import { FIELD_CATALOG, STOCK_SIZES, previewIssues, type LabelValues } from "./label-metrics";
import { CropEditor, PhotoPicker, readPhotoFile, StraightenedPreview, type PhotoProblem } from "./label-photo-crop";
import type { DetectProgress } from "./label-photo-detect";
import { canvasPixels, closestStock, guessLabelQuad, quadSize, rotateQuad, tracingPhotoDataUrl, warpCanvas, type Quad } from "./label-photo-geometry";
import { analyzePhoto, buildLabelDocument, photoPage, type ImportItem } from "./label-photo-import";

/** Width in pixels of the straightened photo the codes and text are read from. */
const READ_WIDTH = 1600;
const CUSTOM = "custom";

export type PhotoImportResult = { document: LabelDocument; photo: string };

type Step = { kind: "pick" } | { kind: "crop" } | { kind: "reading"; progress: DetectProgress } | { kind: "review" };

const kindIcon = { qrcode: QrCode, barcode: Barcode, text: Type } as const;

/**
 * Photo of a label → editable label document, inside New label: pick or take a photo, line up
 * its corners and pick the stock, read it (codes and OCR, in this browser), then check what was
 * found. `onResult` gets the document and the straightened photo once there is something to
 * create, and null otherwise.
 */
export default function PhotoLabelImport({ values, onResult }: { values: LabelValues; onResult: (result: PhotoImportResult | null) => void }) {
  const { t } = useT();
  const id = useId();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [opening, setOpening] = useState(false);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const pixels = useMemo(() => (source ? canvasPixels(source) : null), [source]);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [stockChoice, setStockChoice] = useState<string | null>(null);
  const [customWidth, setCustomWidth] = useState("102.25");
  const [customHeight, setCustomHeight] = useState("76.2");
  const [readError, setReadError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; width: number; height: number } | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const run = useRef(0);

  const size = quad ? quadSize(quad) : null;
  const aspect = size && size.height > 0 ? size.width / size.height : 4 / 3;
  const closest = closestStock(aspect, STOCK_SIZES);
  const stock = stockChoice ?? closest.label;
  const preset = STOCK_SIZES.find((option) => option.label === stock);
  const widthMm = preset ? preset.widthMm : Number(customWidth);
  const heightMm = preset ? preset.heightMm : Number(customHeight);
  const sizeValid = Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm >= 5 && widthMm <= 112 && heightMm >= 5 && heightMm <= 500;
  const page = useMemo(() => photoPage(sizeValid ? widthMm : 102.25, sizeValid ? heightMm : 76.2), [sizeValid, widthMm, heightMm]);

  const document = useMemo(() => (items.some((item) => item.included) ? buildLabelDocument(items, page, values) : null), [items, page, values]);
  const valid = document !== null && validateLabelDocument(document, te200Profile).length === 0;
  const issues = useMemo(() => (document ? previewIssues(document, values) : []), [document, values]);

  useEffect(() => {
    onResult(step.kind === "review" && valid && document && photo ? { document, photo: photo.url } : null);
  }, [step.kind, valid, document, photo, onResult]);

  const openFile = async (file: File) => {
    setProblem(null);
    setOpening(true);
    const result = await readPhotoFile(file);
    setOpening(false);
    if ("problem" in result) return setProblem(result.problem);
    setSource(result.canvas);
    setQuad(guessLabelQuad(result.canvas));
    setStockChoice(null);
    setReadError(null);
    setStep({ kind: "crop" });
  };

  const read = async () => {
    if (!source || !quad || !sizeValid) return;
    const current = ++run.current;
    setReadError(null);
    setStep({ kind: "reading", progress: { stage: "codes", progress: 0 } });
    try {
      const warped = warpCanvas(source, quad, READ_WIDTH, Math.round((READ_WIDTH * page.heightMm) / page.widthMm));
      // Lazy on purpose: Tesseract and the barcode reader load only when a photo is read.
      const { detectPhoto } = await import("./label-photo-detect");
      const detections = await detectPhoto(warped, (progress) => {
        if (current === run.current) setStep({ kind: "reading", progress });
      });
      if (current !== run.current) return;
      setItems(analyzePhoto(detections, page));
      setPhoto({ url: tracingPhotoDataUrl(warped), width: warped.width, height: warped.height });
      setActive(null);
      setStep({ kind: "review" });
    } catch (error) {
      if (current !== run.current) return;
      setReadError(error instanceof Error ? error.message : String(error));
      setStep({ kind: "crop" });
    }
  };

  const update = (itemId: string, change: Partial<Pick<ImportItem, "included" | "binding">>) =>
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...change } : item)));

  if (step.kind === "pick" || !source || !quad || !pixels) {
    return <PhotoPicker onFile={(file) => void openFile(file)} problem={problem} busy={opening} />;
  }

  if (step.kind === "crop" || step.kind === "reading") {
    const reading = step.kind === "reading";
    return (
      <div className="flex min-w-0 flex-col gap-4" aria-busy={reading}>
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-[15px] font-semibold leading-6">{t("printing.library.photo.cropTitle")}</h3>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("printing.library.photo.cropHint")}</p>
        </div>
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
          <CropEditor source={source} quad={quad} onChange={setQuad} />
          <div className="flex min-w-0 flex-col gap-3">
            <StraightenedPreview pixels={pixels} quad={quad} aspect={page.widthMm / page.heightMm} label={t("printing.library.photo.straightened")} />
            <div className="flex flex-wrap items-center gap-1">
              <IconButton label={t("printing.library.photo.rotateLeft")} icon={<RotateCcw />} variant="secondary" disabled={reading} onClick={() => setQuad(rotateQuad(quad, 3))} />
              <IconButton label={t("printing.library.photo.rotateRight")} icon={<RotateCw />} variant="secondary" disabled={reading} onClick={() => setQuad(rotateQuad(quad, 1))} />
              <IconButton label={t("printing.library.photo.findLabel")} icon={<ScanSearch />} variant="secondary" disabled={reading} onClick={() => setQuad(guessLabelQuad(source))} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-stock`} className="text-[13px] font-medium text-muted-foreground">
                {t("printing.library.photo.stock")}
              </label>
              <NativeSelect id={`${id}-stock`} density="compact" value={stock} disabled={reading} onChange={(event) => setStockChoice(event.target.value)}>
                {STOCK_SIZES.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
                <option value={CUSTOM}>{t("printing.library.photo.custom")}</option>
              </NativeSelect>
              <p className="m-0 text-xs leading-4 text-muted-foreground">{t("printing.library.photo.closest", { size: closest.label })}</p>
            </div>
            {stock === CUSTOM ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={`${id}-w`} className="text-[13px] font-medium text-muted-foreground">
                    {t("printing.library.photo.width")}
                  </label>
                  <TextInput id={`${id}-w`} inputMode="decimal" value={customWidth} onChangeText={setCustomWidth} className="font-mono tabular-nums" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={`${id}-h`} className="text-[13px] font-medium text-muted-foreground">
                    {t("printing.library.photo.height")}
                  </label>
                  <TextInput id={`${id}-h`} inputMode="decimal" value={customHeight} onChangeText={setCustomHeight} className="font-mono tabular-nums" />
                </div>
                {sizeValid ? null : (
                  <p role="alert" className="col-span-2 m-0 text-[13px] font-medium text-destructive">
                    {t("printing.library.photo.sizeInvalid")}
                  </p>
                )}
              </div>
            ) : null}
            <Button onPress={() => void read()} loading={reading} disabled={!sizeValid} data-testid="photo-read">
              {t("printing.library.photo.read")}
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                run.current += 1;
                setStep({ kind: "pick" });
              }}
            >
              {t("printing.library.photo.otherPhoto")}
            </Button>
            {reading ? (
              <p role="status" className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="photo-progress">
                {step.progress.stage === "codes" ? t("printing.library.photo.readingCodes") : t("printing.library.photo.readingText", { percent: Math.round(step.progress.progress * 100) })}
              </p>
            ) : null}
            {readError ? (
              <p role="alert" className="m-0 flex items-start gap-1.5 text-[13px] font-medium leading-5 text-destructive">
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{t("printing.library.photo.readFailed", { message: readError })}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const included = items.filter((item) => item.included).length;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="photo-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-semibold leading-6">{t("printing.library.photo.reviewTitle")}</h3>
        <Button variant="ghost" size="sm" onPress={() => setStep({ kind: "crop" })}>
          <ArrowLeft aria-hidden="true" /> {t("printing.library.photo.backToCorners")}
        </Button>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-2 md:items-start">
        {photo ? (
          <figure className="m-0 flex min-w-0 flex-col gap-1.5">
            <div className="relative overflow-hidden rounded-[3px] ring-1 ring-black/10">
              <img src={photo.url} alt="" className="block h-auto w-full" />
              <svg viewBox={`0 0 ${photo.width} ${photo.height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                {items.map((item) => (
                  <rect
                    key={item.id}
                    data-testid={`photo-box-${item.id}`}
                    x={item.photoBox.x}
                    y={item.photoBox.y}
                    width={item.photoBox.width}
                    height={item.photoBox.height}
                    fill={item.included ? "var(--tone-blue-from)" : "none"}
                    fillOpacity={active === item.id ? 0.25 : 0.1}
                    stroke={item.included ? "var(--tone-blue-from)" : "#85858b"}
                    strokeWidth={active === item.id ? 3 : 1.5}
                    strokeDasharray={item.included ? undefined : "4 3"}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            </div>
            <figcaption className="text-[12px] leading-4 text-muted-foreground">{t("printing.library.photo.photoBoxes")}</figcaption>
          </figure>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          {document ? <LabelPreview document={document} values={values} title={t("printing.library.photo.result")} /> : null}
          <p className="m-0 text-[12px] leading-4 text-muted-foreground" data-testid="photo-issues">
            {document ? (issues.length ? t("printing.library.warnings", { count: issues.length }) : t("printing.library.photo.noIssues")) : null}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p role="alert" className="m-0 rounded-input bg-tone-amber-tint px-3 py-2.5 text-[14px] leading-5 text-tone-amber-ink">
          {t("printing.library.photo.nothingFound")}
        </p>
      ) : (
        <section aria-labelledby={`${id}-found`} className="flex min-w-0 flex-col gap-2">
          <h4 id={`${id}-found`} className="m-0 text-[13px] font-semibold text-muted-foreground">
            {t("printing.library.photo.found", { count: items.length })}
          </h4>
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border p-0" data-testid="photo-items">
            {items.map((item) => {
              const Icon = kindIcon[item.kind];
              const kind = item.kind !== "text" ? item.kind : item.role === "caption" || item.role === "value" ? item.role : "text";
              const shown = item.text.length > 48 ? `${item.text.slice(0, 47)}…` : item.text;
              return (
                <li
                  key={item.id}
                  data-testid={`photo-item-${item.id}`}
                  className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2", !item.included && "text-muted-foreground")}
                  onPointerEnter={() => setActive(item.id)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(item.id)}
                  onBlur={() => setActive(null)}
                >
                  <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                    <Checkbox
                      id={`${id}-${item.id}`}
                      checked={item.included}
                      onCheckedChange={(checked) => update(item.id, { included: checked === true })}
                      aria-label={t("printing.library.photo.include", { text: item.text })}
                    />
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <label htmlFor={`${id}-${item.id}`} className="flex min-w-0 flex-col">
                      <span className={cn("truncate text-[14px] leading-5", item.role !== "caption" && "font-mono")} title={item.text}>
                        {shown}
                      </span>
                      <span className="text-[12px] leading-4 text-muted-foreground">{t(`printing.library.photo.kinds.${kind}`)}</span>
                    </label>
                  </div>
                  <NativeSelect
                    density="compact"
                    className="w-full sm:w-48"
                    aria-label={t("printing.library.photo.fieldFor", { text: item.text })}
                    value={item.binding ?? ""}
                    disabled={!item.included}
                    onChange={(event) => update(item.id, { binding: (event.target.value || null) as LabelVariable | null })}
                  >
                    <option value="">{t("printing.library.photo.fixed")}</option>
                    {FIELD_CATALOG.map((variable) => (
                      <option key={variable} value={variable}>
                        {t(`printing.library.photo.fields.${variable}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              );
            })}
          </ul>
          {included === 0 ? (
            <p role="alert" className="m-0 text-[13px] font-medium text-destructive">
              {t("printing.library.photo.nothingIncluded")}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
