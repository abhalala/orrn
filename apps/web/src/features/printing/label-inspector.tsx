import type { LabelElement } from "@orrn/domain";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";

export function LabelInspector({
  element,
  onChange,
}: {
  element: LabelElement | undefined;
  onChange: (update: Partial<LabelElement>) => void;
}) {
  if (!element) return <p className="text-sm text-muted-foreground">Select an element to edit its position and size.</p>;
  return (
    <div className="grid grid-cols-2 gap-3" aria-label="Element inspector">
      <div>
        <Label htmlFor="element-x">X (mm)</Label>
        <Input id="element-x" type="number" step="0.25" value={element.xMm} onChange={(event) => onChange({ xMm: Number(event.target.value) })} />
      </div>
      <div>
        <Label htmlFor="element-y">Y (mm)</Label>
        <Input id="element-y" type="number" step="0.25" value={element.yMm} onChange={(event) => onChange({ yMm: Number(event.target.value) })} />
      </div>
      <div>
        <Label htmlFor="element-width">Width (mm)</Label>
        <Input id="element-width" min="0.25" type="number" step="0.25" value={element.widthMm} onChange={(event) => onChange({ widthMm: Number(event.target.value) })} />
      </div>
      <div>
        <Label htmlFor="element-height">Height (mm)</Label>
        <Input id="element-height" min="0.25" type="number" step="0.25" value={element.heightMm} onChange={(event) => onChange({ heightMm: Number(event.target.value) })} />
      </div>
      <div className="col-span-2">
        <Label htmlFor="element-rotation">Rotation</Label>
        <Input id="element-rotation" type="number" step="90" value={element.rotation} onChange={(event) => onChange({ rotation: Number(event.target.value) as LabelElement["rotation"] })} />
      </div>
    </div>
  );
}
