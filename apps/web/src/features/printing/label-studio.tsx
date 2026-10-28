import { compactLabel, operationsDense, polishedLabel, te200Profile, validateLabelDocument, type LabelDocument, type LabelElement } from "@orrn/domain";
import { Button, IconButton } from "@orrn/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@orrn/ui/components/dropdown-menu";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  Barcode,
  ChevronDown,
  CopyPlus,
  Eye,
  Grid3x3,
  ImageIcon,
  ImagePlus,
  Keyboard,
  Minus,
  MoreHorizontal,
  PenLine,
  Plus,
  QrCode,
  Redo2,
  RotateCw,
  Scan,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { LabelPreview } from "./label-artwork";
import { LabelCanvas, RULER_PX, STAGE_PAD_PX } from "./label-canvas";
import { ElementInspector, PageInspector } from "./label-inspector";
import { useTracingPhoto } from "./label-photo-store";
import { useLabelSample } from "./use-label-sample";
import { FIELD_CATALOG, VARIABLE_LABELS, elementBounds, elementName, elementShape, previewIssues, resolveContent, type LabelValues } from "./label-metrics";
import {
  addElement,
  alignElements,
  deleteElements,
  distributeElements,
  duplicateElements,
  labelDocumentFromSchema,
  moveElements,
  moveLayer,
  newLabelEditor,
  redo,
  replaceDocument,
  rotateElements,
  selectElement,
  pasteElements,
  selectElements,
  undo,
  updateElement,
  updatePage,
  type Alignment,
  type LabelEditorState,
} from "./label-studio-model";

// Its own chunk: the photo crop and straightening load only when someone adds a tracing photo.
const TracingPhotoDialog = lazy(() => import("./label-tracing-photo-dialog"));

const builtins: Array<{ name: string; note: string; document: LabelDocument }> = [
  { name: "Operations dense", note: "Every field, aligned columns", document: operationsDense },
  { name: "Polished classic", note: "Serial, QR, measures, total", document: polishedLabel },
  { name: "Compact", note: "Serial, Code 128, weight", document: compactLabel },
];

/** px per mm at 100 % (CSS 96 dpi). */
const ACTUAL_SIZE = 96 / 25.4;
const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

type PanelTab = "properties" | "layers" | "sample" | "checks";

/** Copied elements survive switching templates within the session, like any design tool. */
const clipboard: { elements: LabelElement[]; pastes: number } = { elements: [], pastes: 0 };

const typeIcon: Partial<Record<LabelElement["type"], ReactNode>> = {
  text: <Type aria-hidden="true" className="size-4" />,
  barcode: <Barcode aria-hidden="true" className="size-4" />,
  qrcode: <QrCode aria-hidden="true" className="size-4" />,
  line: <Minus aria-hidden="true" className="size-4" />,
  box: <Square aria-hidden="true" className="size-4" />,
};

function ToolDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

function Tool({ label, icon, onClick, disabled, pressed }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <IconButton
      label={label}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn("size-9 rounded-full [&_svg]:size-[18px] pointer-coarse:size-11", pressed && "bg-foreground text-background hover:bg-foreground/90 hover:text-background")}
    />
  );
}

/** Width of an element that may mount after the first render (the editor waits for its query). */
function useElementWidth<T extends HTMLElement>() {
  const [element, ref] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, width };
}

export function LabelStudio({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery(trpc.spool.labelDocuments.get.queryOptions({ templateId }));
  const [sampleSerial, setSampleSerial] = useState<string | undefined>();
  const { values, serial: sampleBundle, query: sample } = useLabelSample(sampleSerial);
  const [state, setState] = useState<LabelEditorState | null>(null);
  const [saved, setSaved] = useState("");
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [snap, setSnap] = useState(true);
  const [preview, setPreview] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [tab, setTab] = useState<PanelTab>("properties");
  const tracing = useTracingPhoto(templateId);
  const [underlay, setUnderlay] = useState(true);
  const [underlayOpacity, setUnderlayOpacity] = useState(0.5);
  const [tracingOpen, setTracingOpen] = useState(false);
  const viewport = useElementWidth<HTMLDivElement>();

  useEffect(() => {
    if (!query.data) return;
    const document = labelDocumentFromSchema(query.data.draftSchema ?? query.data.schema);
    setState(newLabelEditor(document));
    setSaved(JSON.stringify(document));
  }, [query.data]);

  const updateDraft = useMutation(trpc.spool.labelDocuments.updateDraft.mutationOptions({ onError: (error) => toast.error(error.message) }));
  const publish = useMutation(
    trpc.spool.labelDocuments.publish.mutationOptions({
      onSuccess: async () => {
        toast.success("Template published");
        await queryClient.invalidateQueries({ queryKey: trpc.spool.labelDocuments.get.queryKey({ templateId }) });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const clone = useMutation(
    trpc.spool.labelDocuments.clone.mutationOptions({
      onSuccess: (result) => {
        toast.success("Template cloned");
        void navigate({ to: "/printing/templates/$templateId", params: { templateId: result.id } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const document = state?.document;
  const blocking = useMemo(() => (document ? validateLabelDocument(document, te200Profile) : []), [document]);
  const warnings = useMemo(() => (document ? previewIssues(document, values) : []), [document, values]);
  const flaggedIds = useMemo(() => new Set(warnings.map((issue) => issue.elementId)), [warnings]);
  const boundsOf = useCallback((element: LabelElement) => elementBounds(element, elementShape(element, values)), [values]);
  const dirty = document ? JSON.stringify(document) !== saved : false;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (query.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Label Studio" back={{ to: "/printing?tab=labels", label: "Labels" }} />
        <p role="alert" className="m-0 rounded-card border border-border bg-card p-5 text-[15px] text-destructive">
          {query.error.message}
        </p>
      </div>
    );
  }
  if (query.isPending || !state || !document) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        <PageHeader title="Label Studio" back={{ to: "/printing?tab=labels", label: "Labels" }} subtitle="Loading the label" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_384px]">
          <Skeleton className="h-[420px] w-full rounded-card" />
          <Skeleton className="h-[420px] w-full rounded-card" />
        </div>
      </div>
    );
  }

  const selectedIds = state.selectedIds;
  const selected = selectedIds.length === 1 ? document.elements.find((element) => element.id === selectedIds[0]) : undefined;
  const apply = (next: LabelEditorState) => setState(next);
  const fitScale = viewport.width > 0 ? Math.min(14, Math.max(2, (viewport.width - RULER_PX - STAGE_PAD_PX * 2 - 2) / document.page.widthMm)) : 4;
  const scale = zoom === "fit" ? fitScale : zoom * ACTUAL_SIZE;
  const zoomPercent = Math.round((scale / ACTUAL_SIZE) * 100);
  const stepZoom = (direction: 1 | -1) => {
    const current = scale / ACTUAL_SIZE;
    const next = direction > 0 ? ZOOM_STEPS.find((step) => step > current + 0.01) : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.01);
    if (next) setZoom(next);
  };

  const saveDraft = async () => {
    await updateDraft.mutateAsync({ templateId, document });
    setSaved(JSON.stringify(document));
    toast.success("Draft saved");
  };
  const publishDraft = async () => {
    await updateDraft.mutateAsync({ templateId, document });
    setSaved(JSON.stringify(document));
    await publish.mutateAsync({ templateId });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("input, select, textarea, [role='menu']")) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      apply(event.shiftKey ? redo(state) : undo(state));
    } else if (mod && key === "y") {
      event.preventDefault();
      apply(redo(state));
    } else if (mod && key === "d") {
      event.preventDefault();
      apply(duplicateElements(state, selectedIds));
    } else if (mod && key === "a") {
      event.preventDefault();
      apply(selectElements(state, document.elements.map((element) => element.id)));
    } else if (mod && key === "c" && selectedIds.length > 0) {
      clipboard.elements = structuredClone(document.elements.filter((element) => selectedIds.includes(element.id)));
      clipboard.pastes = 0;
    } else if (mod && key === "x" && selectedIds.length > 0) {
      clipboard.elements = structuredClone(document.elements.filter((element) => selectedIds.includes(element.id)));
      clipboard.pastes = 0;
      apply(deleteElements(state, selectedIds));
    } else if (mod && key === "v" && clipboard.elements.length > 0) {
      event.preventDefault();
      clipboard.pastes += 1;
      apply(pasteElements(state, clipboard.elements, 2 * clipboard.pastes));
    } else if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
      event.preventDefault();
      apply(deleteElements(state, selectedIds));
    } else if (event.key === "Escape") {
      apply(selectElements(state, []));
    } else if (event.key.startsWith("Arrow") && selectedIds.length > 0 && target.closest("[aria-label='Label canvas']")) {
      event.preventDefault();
      const distance = event.shiftKey ? 1 : 0.25;
      const dx = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
      const dy = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
      apply(moveElements(state, selectedIds, dx, dy));
    }
  };

  const align = (alignment: Alignment) => apply(alignElements(state, selectedIds, alignment, boundsOf));
  const status = dirty ? "Unsaved changes" : query.data.draftSchema ? "Draft saved" : `Published version ${query.data.version}`;

  return (
    <div className="flex min-w-0 flex-col gap-5" onKeyDown={onKeyDown}>
      <PageHeader
        title="Label Studio"
        back={{ to: "/printing?tab=labels", label: "Labels" }}
        subtitle={`${query.data.name} · ${document.page.widthMm} × ${document.page.heightMm} mm · ${status}`}
        actions={
          <Can do="spool.push_templates">
            <Button variant="secondary" onClick={() => void saveDraft()} loading={updateDraft.isPending && !publish.isPending} disabled={!dirty}>
              Save draft
            </Button>
            <Button onClick={() => void publishDraft()} loading={publish.isPending} disabled={blocking.length > 0}>
              Publish template
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More label actions" variant="secondary" icon={<MoreHorizontal />} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem disabled={clone.isPending} onSelect={() => clone.mutate({ templateId, name: `${query.data.name} copy` })}>
                  <CopyPlus aria-hidden="true" className="size-4" /> Clone template
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTracingOpen(true)}>
                  <ImagePlus aria-hidden="true" className="size-4" /> {tracing.photo ? "Replace tracing photo" : "Add tracing photo"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Start from a built-in</DropdownMenuLabel>
                {builtins.map((builtin) => (
                  <DropdownMenuItem key={builtin.name} onSelect={() => apply(replaceDocument(state, builtin.document))}>
                    <span className="flex flex-col">
                      <span>{builtin.name}</span>
                      <span className="text-xs text-muted-foreground">{builtin.note}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Can>
        }
      />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_384px] xl:items-start">
        <section aria-label="Label editor" className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-sm">
          <div role="toolbar" aria-label="Editor tools" className="flex min-w-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
            <Tool label="Undo" icon={<Undo2 />} onClick={() => apply(undo(state))} disabled={!state.past.length} />
            <Tool label="Redo" icon={<Redo2 />} onClick={() => apply(redo(state))} disabled={!state.future.length} />
            <ToolDivider />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 gap-1 px-2.5">
                  <Plus aria-hidden="true" /> <span className="max-2xl:sr-only">Add</span> <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <PenLine aria-hidden="true" className="size-4" /> Bundle field
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                    {FIELD_CATALOG.map((variable) => (
                      <DropdownMenuItem key={variable} onSelect={() => apply(addElement(state, "text", variable))}>
                        {VARIABLE_LABELS[variable]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onSelect={() => apply(addElement(state, "text"))}>
                  <Type aria-hidden="true" className="size-4" /> Fixed text
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => apply(addElement(state, "barcode"))}>
                  <Barcode aria-hidden="true" className="size-4" /> Barcode
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => apply(addElement(state, "qrcode"))}>
                  <QrCode aria-hidden="true" className="size-4" /> QR code
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => apply(addElement(state, "line"))}>
                  <Minus aria-hidden="true" className="size-4" /> Line
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => apply(addElement(state, "box"))}>
                  <Square aria-hidden="true" className="size-4" /> Box
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => apply(addElement(state, "datamatrix"))}>
                  <Scan aria-hidden="true" className="size-4" /> Data Matrix
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => apply(addElement(state, "pdf417"))}>
                  <Barcode aria-hidden="true" className="size-4" /> PDF417
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 gap-1 px-2.5" disabled={selectedIds.length === 0}>
                  <AlignStartVertical aria-hidden="true" /> <span className="max-2xl:sr-only">Align</span> <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{selectedIds.length === 1 ? "Align to the label" : "Align to the selection"}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => align("left")}><AlignStartVertical aria-hidden="true" className="size-4" /> Left edges</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => align("center")}><AlignCenterVertical aria-hidden="true" className="size-4" /> Centres</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => align("right")}><AlignEndVertical aria-hidden="true" className="size-4" /> Right edges</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => align("top")}><AlignStartHorizontal aria-hidden="true" className="size-4" /> Top edges</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => align("middle")}><AlignCenterHorizontal aria-hidden="true" className="size-4" /> Middles</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => align("bottom")}><AlignEndHorizontal aria-hidden="true" className="size-4" /> Bottom edges</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={selectedIds.length < 3} onSelect={() => apply(distributeElements(state, selectedIds, "horizontal", boundsOf))}>
                  <AlignHorizontalDistributeCenter aria-hidden="true" className="size-4" /> Space evenly across
                </DropdownMenuItem>
                <DropdownMenuItem disabled={selectedIds.length < 3} onSelect={() => apply(distributeElements(state, selectedIds, "vertical", boundsOf))}>
                  <AlignVerticalDistributeCenter aria-hidden="true" className="size-4" /> Space evenly down
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ToolDivider />
            <Tool label="Rotate 90°" icon={<RotateCw />} onClick={() => apply(rotateElements(state, selectedIds))} disabled={selectedIds.length === 0} />
            <Tool label="Duplicate" icon={<CopyPlus />} onClick={() => apply(duplicateElements(state, selectedIds))} disabled={selectedIds.length === 0} />
            <Tool label="Delete" icon={<Trash2 />} onClick={() => apply(deleteElements(state, selectedIds))} disabled={selectedIds.length === 0} />
            <div className="ml-auto flex items-center gap-1">
              {tracing.photo ? <Tool label="Photo underlay" icon={<ImageIcon />} pressed={underlay} onClick={() => setUnderlay(!underlay)} /> : null}
              <Tool label="Snap to 0.5 mm grid" icon={<Grid3x3 />} pressed={snap} onClick={() => setSnap(!snap)} />
              <Tool label="Print preview" icon={<Eye />} pressed={preview} onClick={() => setPreview(!preview)} />
              <ShortcutsMenu />
            </div>
          </div>

          <div ref={viewport.ref} className="relative max-h-[70dvh] min-h-[280px] min-w-0 overflow-auto bg-surface-sunken">
            {zoom === "fit" && viewport.width === 0 ? null : preview ? (
              <div className="p-7" style={{ width: document.page.widthMm * scale + STAGE_PAD_PX * 2 + RULER_PX }}>
                <LabelPreview document={document} values={values} title="Print preview" />
              </div>
            ) : (
              <LabelCanvas
                document={document}
                values={values}
                scale={scale}
                snap={snap}
                selectedIds={selectedIds}
                flaggedIds={flaggedIds}
                onSelect={(id, additive) => {
                  apply(selectElement(state, id, additive));
                  setTab("properties");
                }}
                onSelectMany={(ids, additive) => apply(selectElements(state, additive ? [...new Set([...selectedIds, ...ids])] : ids))}
                onClear={() => apply(selectElements(state, []))}
                onCursor={setCursor}
                onMove={(ids, dx, dy) => apply(moveElements(state, ids, dx, dy))}
                onResize={(id, update) => apply(updateElement(state, id, (element) => ({ ...element, ...update })))}
                underlay={tracing.photo && underlay ? { href: tracing.photo, opacity: underlayOpacity } : null}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-1.5 pr-2 pl-4 text-[13px] text-muted-foreground">
            <span className={cn("min-w-0 flex-1 truncate", !selected && selectedIds.length < 2 && "max-sm:invisible")}>
              {selected
                ? `${elementName(selected)} · X ${selected.xMm} · Y ${selected.yMm} mm`
                : selectedIds.length > 1
                  ? `${selectedIds.length} selected · Shift-click to add or remove`
                  : "Drag to move · Drag on empty label to select · Hold Alt to skip guides"}
            </span>
            {cursor ? (
              <span className="font-mono tabular-nums" aria-hidden="true">
                {cursor.x.toFixed(2)}, {cursor.y.toFixed(2)} mm
              </span>
            ) : null}
            <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 font-medium hover:bg-accent" onClick={() => setTab("checks")}>
              <span aria-hidden="true" className={cn("size-2 rounded-full", blocking.length ? "bg-tone-red-to" : warnings.length ? "bg-tone-amber-to" : "bg-tone-green-to")} />
              {blocking.length + warnings.length === 0 ? "Ready to print" : `${blocking.length + warnings.length} to check`}
            </button>
            <div className="flex items-center" role="group" aria-label="Zoom">
              <Tool label="Zoom out" icon={<Minus />} onClick={() => stepZoom(-1)} disabled={scale / ACTUAL_SIZE <= ZOOM_STEPS[0] + 0.01} />
              <button
                type="button"
                className="h-9 min-w-14 rounded-full px-2 font-mono text-[13px] font-semibold text-foreground tabular-nums hover:bg-accent pointer-coarse:h-11"
                aria-label={`Zoom ${zoomPercent}%, fit to width`}
                title="Fit to width"
                onClick={() => setZoom("fit")}
              >
                {zoom === "fit" ? "Fit" : `${zoomPercent}%`}
              </button>
              <Tool label="Zoom in" icon={<Plus />} onClick={() => stepZoom(1)} disabled={scale / ACTUAL_SIZE >= ZOOM_STEPS.at(-1)! - 0.01} />
            </div>
          </div>
        </section>

        <aside aria-label="Label settings" className="flex min-w-0 flex-col rounded-card border border-border bg-card p-4 shadow-sm">
          <Tabs
            label="Label settings"
            value={tab}
            onValueChange={(next) => setTab(next as PanelTab)}
            items={[
              { id: "properties", label: selected ? "Element" : "Label" },
              { id: "layers", label: "Layers" },
              { id: "sample", label: "Sample" },
              { id: "checks", label: blocking.length + warnings.length ? `Checks ${blocking.length + warnings.length}` : "Checks" },
            ]}
          >
            {tab === "properties" ? (
              selected ? (
                <ElementInspector element={selected} values={values} onChange={(update) => apply(updateElement(state, selected.id, (element) => ({ ...element, ...update })))} />
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="m-0 text-[15px] leading-6 text-muted-foreground">
                    {selectedIds.length > 1 ? `${selectedIds.length} elements selected. Use Align to line them up.` : "Select an element on the label to edit it. These are the label stock settings."}
                  </p>
                  <PageInspector page={document.page} onChange={(update) => apply(updatePage(state, update))} />
                  {tracing.photo ? (
                    <TracingPhotoPanel
                      shown={underlay}
                      opacity={underlayOpacity}
                      onShownChange={setUnderlay}
                      onOpacityChange={setUnderlayOpacity}
                      onRemove={() =>
                        void tracing
                          .remove()
                          .then(() => toast.success("Tracing photo removed"))
                          .catch(() => toast.error("Couldn't remove the tracing photo"))
                      }
                    />
                  ) : null}
                </div>
              )
            ) : null}
            {tab === "layers" ? <LayersPanel state={state} values={values} apply={apply} /> : null}
            {tab === "sample" ? (
              <SamplePanel
                serial={sampleBundle}
                loading={sample.isFetching}
                error={sample.isError ? sample.error.message : undefined}
                values={values}
                onLoad={(serial) => setSampleSerial(serial)}
              />
            ) : null}
            {tab === "checks" ? (
              <ChecksPanel
                blocking={blocking.map((issue) => {
                  const index = Number(/^elements\.(\d+)/.exec(issue.path)?.[1]);
                  return { message: issue.message, elementId: Number.isInteger(index) ? document.elements[index]?.id : undefined };
                })}
                warnings={warnings}
                onPick={(id) => {
                  apply(selectElements(state, [id]));
                  setTab("properties");
                }}
              />
            ) : null}
          </Tabs>
        </aside>
      </div>
      {tracingOpen ? (
        <Suspense fallback={null}>
          <TracingPhotoDialog
            open={tracingOpen}
            onOpenChange={setTracingOpen}
            page={document.page}
            onSave={async (dataUrl) => {
              try {
                await tracing.save(dataUrl);
              } catch {
                toast.error("Couldn't keep the photo in this browser");
                return;
              }
              setUnderlay(true);
              toast.success("Tracing photo added");
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Nudge 0.25 mm", "Arrow keys"],
  ["Nudge 1 mm", "Shift + arrows"],
  ["Add to selection", "Shift + click"],
  ["Select all", "Ctrl/⌘ A"],
  ["Copy, cut, paste", "Ctrl/⌘ C, X, V"],
  ["Duplicate", "Ctrl/⌘ D"],
  ["Undo, redo", "Ctrl/⌘ Z, Shift Z"],
  ["Delete", "Delete"],
  ["Move without guides", "Hold Alt"],
  ["Clear selection", "Esc"],
];

function TracingPhotoPanel({
  shown,
  opacity,
  onShownChange,
  onOpacityChange,
  onRemove,
}: {
  shown: boolean;
  opacity: number;
  onShownChange: (shown: boolean) => void;
  onOpacityChange: (opacity: number) => void;
  onRemove: () => void;
}) {
  const percent = Math.round(opacity * 100);
  return (
    <section aria-labelledby="tracing-photo-title" className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h3 id="tracing-photo-title" className="m-0 text-[13px] font-semibold text-foreground">
          Tracing photo
        </h3>
        <p className="m-0 text-xs leading-4 text-muted-foreground">Shown under the label while you edit, never printed. Kept in this browser only.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="tracing-photo-opacity" className="text-[13px] font-medium text-muted-foreground">
            Photo opacity
          </label>
          <span aria-hidden="true" className="font-mono text-[13px] tabular-nums text-foreground">
            {percent}%
          </span>
        </div>
        <input
          id="tracing-photo-opacity"
          type="range"
          min={10}
          max={100}
          step={5}
          value={percent}
          aria-valuetext={`${percent}%`}
          disabled={!shown}
          onChange={(event) => onOpacityChange(Number(event.target.value) / 100)}
          className="h-11 w-full cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => onShownChange(!shown)}>
          {shown ? "Hide photo" : "Show photo"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove photo
        </Button>
      </div>
    </section>
  );
}

function ShortcutsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Keyboard shortcuts" icon={<Keyboard />} className="size-9 [&_svg]:size-[18px] pointer-coarse:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-2">
        <DropdownMenuLabel>Keyboard shortcuts</DropdownMenuLabel>
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-2 pb-1 text-[13px]">
          {SHORTCUTS.map(([action, keys]) => (
            <div key={action} className="contents">
              <dt className="text-muted-foreground">{action}</dt>
              <dd className="m-0 text-right">
                <kbd className="rounded-[6px] border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-[12px]">{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LayersPanel({ state, values, apply }: { state: LabelEditorState; values: LabelValues; apply: (next: LabelEditorState) => void }) {
  const elements = [...state.document.elements].reverse();
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Layers, top first">
      {elements.map((element, index) => {
        const selected = state.selectedIds.includes(element.id);
        const value = element.type === "line" || element.type === "box" ? "" : resolveContent(element, values);
        return (
          <li key={element.id} className={cn("flex min-w-0 items-center gap-1 rounded-input pr-1", selected ? "bg-tone-blue-tint" : "hover:bg-accent")}>
            <button
              type="button"
              aria-pressed={selected}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-input px-2.5 text-left"
              onClick={(event) => apply(selectElement(state, element.id, event.shiftKey || event.metaKey))}
            >
              <span className="shrink-0 text-muted-foreground">{typeIcon[element.type] ?? <Scan aria-hidden="true" className="size-4" />}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-medium">{elementName(element)}</span>
                {value && value !== elementName(element) ? <span className="truncate font-mono text-xs text-muted-foreground">{value}</span> : null}
              </span>
            </button>
            <IconButton label={`Bring ${elementName(element)} forward`} icon={<ArrowUp />} className="size-8 [&_svg]:size-4" disabled={index === 0} onClick={() => apply(moveLayer(state, element.id, "forward"))} />
            <IconButton label={`Send ${elementName(element)} backward`} icon={<ArrowDown />} className="size-8 [&_svg]:size-4" disabled={index === elements.length - 1} onClick={() => apply(moveLayer(state, element.id, "backward"))} />
          </li>
        );
      })}
    </ol>
  );
}

function SamplePanel({ serial, loading, error, values, onLoad }: { serial?: string; loading: boolean; error?: string; values: LabelValues; onLoad: (serial: string | undefined) => void }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onLoad(text.trim() || undefined);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">
        {serial ? (
          <>
            Showing bundle <span className="font-mono font-semibold text-foreground">{serial}</span>, with the values a print of it sends.
          </>
        ) : (
          "Showing example values. Load a bundle to see its real label."
        )}
      </p>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="sample-serial" className="sr-only">
          Bundle number
        </label>
        <Input id="sample-serial" value={text} onChange={(event) => setText(event.target.value)} placeholder="Bundle number" className="h-10 min-w-0 flex-1 font-mono" autoComplete="off" spellCheck={false} />
        <Button type="submit" variant="secondary" size="sm" className="h-10" loading={loading}>
          Load
        </Button>
      </form>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
        {FIELD_CATALOG.map((variable) => (
          <div key={variable} className="contents">
            <dt className="text-muted-foreground">{VARIABLE_LABELS[variable]}</dt>
            <dd className="m-0 truncate text-right font-mono text-foreground" title={values[variable]}>
              {values[variable] || "Empty"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChecksPanel({
  blocking,
  warnings,
  onPick,
}: {
  blocking: Array<{ message: string; elementId?: string }>;
  warnings: Array<{ message: string; elementId: string }>;
  onPick: (id: string) => void;
}) {
  if (blocking.length + warnings.length === 0) {
    return <p className="m-0 text-[15px] leading-6 text-muted-foreground">Nothing to fix. Every element fits the label with this bundle's values, and the printer accepts the document.</p>;
  }
  const row = (issue: { message: string; elementId?: string }, tone: "red" | "amber", key: string) => (
    <li key={key}>
      <button
        type="button"
        disabled={!issue.elementId}
        onClick={() => issue.elementId && onPick(issue.elementId)}
        className={cn("flex min-h-11 w-full items-start gap-2.5 rounded-input px-3 py-2.5 text-left text-[14px] leading-5", tone === "red" ? "bg-tone-red-tint text-tone-red-ink" : "bg-tone-amber-tint text-tone-amber-ink")}
      >
        {issue.message}
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      {blocking.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">Fix before publishing</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{blocking.map((issue, index) => row(issue, "red", `b${index}`))}</ul>
        </div>
      ) : null}
      {warnings.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">Will print badly with this bundle</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{warnings.map((issue, index) => row(issue, "amber", `w${index}`))}</ul>
        </div>
      ) : null}
    </div>
  );
}
