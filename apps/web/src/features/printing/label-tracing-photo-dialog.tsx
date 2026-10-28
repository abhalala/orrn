import type { LabelPage } from "@orrn/domain";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { RotateCcw, RotateCw, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";

import { CropEditor, PhotoPicker, readPhotoFile, StraightenedPreview, type PhotoProblem } from "./label-photo-crop";
import { canvasPixels, guessLabelQuad, rotateQuad, tracingPhotoDataUrl, warpCanvas, type Quad } from "./label-photo-geometry";

/**
 * Studio: attach (or replace) the photo a design is traced from. The photo is straightened to
 * the label's own stock and kept in this browser only; nothing is read off it.
 */
export default function TracingPhotoDialog({
  open,
  onOpenChange,
  page,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: Pick<LabelPage, "widthMm" | "heightMm">;
  onSave: (dataUrl: string) => Promise<void>;
}) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const pixels = useMemo(() => (source ? canvasPixels(source) : null), [source]);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [problem, setProblem] = useState<PhotoProblem | null>(null);
  const [busy, setBusy] = useState(false);

  const openFile = async (file: File) => {
    setProblem(null);
    setBusy(true);
    const result = await readPhotoFile(file);
    setBusy(false);
    if ("problem" in result) return setProblem(result.problem);
    setSource(result.canvas);
    setQuad(guessLabelQuad(result.canvas));
  };

  const save = async () => {
    if (!source || !quad) return;
    setBusy(true);
    try {
      const width = 1400;
      await onSave(tracingPhotoDataUrl(warpCanvas(source, quad, width, Math.round((width * page.heightMm) / page.widthMm))));
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tracing photo"
      description="A photo of the label you are copying, shown under the design while you edit. It is never printed and stays in this browser."
      maxWidth={source ? 880 : 520}
      actions={
        <>
          <DialogCloseButton onPress={() => onOpenChange(false)} />
          <Button onPress={() => void save()} loading={busy && Boolean(source)} disabled={!source || !quad}>
            Use photo
          </Button>
        </>
      }
    >
      {source && quad && pixels ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
          <CropEditor source={source} quad={quad} onChange={setQuad} />
          <div className="flex min-w-0 flex-col gap-3">
            <StraightenedPreview pixels={pixels} quad={quad} aspect={page.widthMm / page.heightMm} label="Straightened photo" />
            <div className="flex flex-wrap items-center gap-1">
              <IconButton label="Turn left" icon={<RotateCcw />} variant="secondary" onClick={() => setQuad(rotateQuad(quad, 3))} />
              <IconButton label="Turn right" icon={<RotateCw />} variant="secondary" onClick={() => setQuad(rotateQuad(quad, 1))} />
              <IconButton label="Find the label again" icon={<ScanSearch />} variant="secondary" onClick={() => setQuad(guessLabelQuad(source))} />
            </div>
            <p className="m-0 text-xs leading-4 text-muted-foreground">
              Straightened to {page.widthMm} × {page.heightMm} mm, this label's stock.
            </p>
            <Button variant="ghost" onPress={() => setSource(null)}>
              Choose another photo
            </Button>
          </div>
        </div>
      ) : (
        <PhotoPicker onFile={(file) => void openFile(file)} problem={problem} busy={busy} />
      )}
    </Dialog>
  );
}
