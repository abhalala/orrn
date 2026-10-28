import { compactLabel, operationsDense, polishedLabel, type LabelDocument } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlignLeft, Copy, Redo2, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { LabelCanvas } from "./label-canvas";
import { LabelInspector } from "./label-inspector";
import {
  alignElements,
  deleteElement,
  duplicateElement,
  moveElement,
  newLabelEditor,
  labelDocumentFromSchema,
  redo,
  rotateElement,
  selectElement,
  undo,
  updateElement,
  type LabelEditorState,
} from "./label-studio-model";

const builtins: Array<{ name: string; document: LabelDocument }> = [
  { name: "Operations dense", document: operationsDense },
  { name: "Polished label", document: polishedLabel },
  { name: "Compact label", document: compactLabel },
];

export function LabelStudio({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery(trpc.spool.labelDocuments.get.queryOptions({ templateId }));
  const [state, setState] = useState<LabelEditorState | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (query.data) setState(newLabelEditor(labelDocumentFromSchema(query.data.draftSchema ?? query.data.schema)));
  }, [query.data]);

  const updateDraft = useMutation(trpc.spool.labelDocuments.updateDraft.mutationOptions({
    onError: (error) => toast.error(error.message),
  }));
  const publish = useMutation(trpc.spool.labelDocuments.publish.mutationOptions({
    onSuccess: async () => {
      toast.success("Template published");
      await queryClient.invalidateQueries({ queryKey: trpc.spool.labelDocuments.get.queryKey({ templateId }) });
    },
    onError: (error) => toast.error(error.message),
  }));
  const clone = useMutation(trpc.spool.labelDocuments.clone.mutationOptions({
    onSuccess: (result) => {
      toast.success("Template cloned");
      void navigate({ to: "/printing/templates/$templateId", params: { templateId: result.id } });
    },
    onError: (error) => toast.error(error.message),
  }));

  if (query.isError) return <p role="alert" className="text-sm text-destructive">{query.error.message}</p>;
  if (query.isPending || !state) return <p className="text-sm text-muted-foreground">Loading label studio…</p>;

  const selected = state.document.elements.find((element) => state.selectedIds.includes(element.id));
  const apply = (next: LabelEditorState) => setState(next);
  const saveDraft = () => updateDraft.mutate({ templateId, document: state.document });
  const publishDraft = async () => {
    await updateDraft.mutateAsync({ templateId, document: state.document });
    await publish.mutateAsync({ templateId });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Label Studio"
        subtitle={`${query.data.name} · ${state.document.page.widthMm} × ${state.document.page.heightMm} mm`}
        actions={
          <Can do="spool.push_templates">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={saveDraft} disabled={updateDraft.isPending}>Save draft</Button>
              <Button onClick={() => void publishDraft()} disabled={publish.isPending || updateDraft.isPending}>Publish template</Button>
              <Button variant="outline" onClick={() => clone.mutate({ templateId, name: `${query.data.name} copy` })} disabled={clone.isPending}>Clone</Button>
            </div>
          </Can>
        }
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Built-in layouts">
        <span className="text-sm font-medium">Built-ins</span>
        {builtins.map((builtin) => (
          <Button key={builtin.name} size="sm" variant="outline" onClick={() => setState(newLabelEditor(structuredClone(builtin.document)))}>{builtin.name}</Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-border py-3" aria-label="Editor tools">
        <Button aria-label="Undo" variant="outline" size="icon" onClick={() => apply(undo(state))} disabled={!state.past.length}><Undo2 /></Button>
        <Button aria-label="Redo" variant="outline" size="icon" onClick={() => apply(redo(state))} disabled={!state.future.length}><Redo2 /></Button>
        <Button variant="outline" size="sm" onClick={() => selected && apply(rotateElement(state, selected.id))} disabled={!selected}><RotateCw /> Rotate 90°</Button>
        <Button variant="outline" size="sm" onClick={() => selected && apply(duplicateElement(state, selected.id))} disabled={!selected}><Copy /> Duplicate</Button>
        <Button variant="outline" size="sm" onClick={() => selected && apply(deleteElement(state, selected.id))} disabled={!selected}><Trash2 /> Delete</Button>
        <Button variant="outline" size="sm" onClick={() => apply(alignElements(state, "left"))} disabled={state.document.elements.length < 2}><AlignLeft /> Align left</Button>
        <label className="ml-auto flex items-center gap-2 text-sm" htmlFor="studio-zoom">Zoom
          <select id="studio-zoom" className="rounded-md border border-input bg-background px-2 py-1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
            <option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option>
          </select>
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%` }}>
          <LabelCanvas
            document={state.document}
            selectedIds={state.selectedIds}
            onSelect={(id) => apply(selectElement(state, id))}
            onMove={(id, dx, dy) => apply(moveElement(state, id, dx, dy))}
          />
        </div>
        <aside className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">Inspector</h2>
          <LabelInspector element={selected} onChange={(update) => selected && apply(updateElement(state, selected.id, (element) => ({ ...element, ...update })))} />
          <dl className="grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
            <dt>Page</dt><dd className="text-right text-foreground">{state.document.page.dpi} DPI</dd>
            <dt>Variables</dt><dd className="text-right text-foreground">{new Set(state.document.elements.map((element) => element.variable).filter(Boolean)).size}</dd>
            <dt>Elements</dt><dd className="text-right text-foreground">{state.document.elements.length}</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
