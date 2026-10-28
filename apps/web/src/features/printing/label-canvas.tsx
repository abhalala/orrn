import type { LabelDocument, LabelElement } from "@orrn/domain";

const SCALE = 4;

function elementLabel(element: LabelElement): string {
  if (element.type === "text") return element.content ?? element.variable ?? "Text";
  if (element.type === "qrcode") return "QR";
  if (element.type === "barcode") return "▥";
  if (element.type === "line") return "―";
  return "Element";
}

export function LabelCanvas({
  document,
  selectedIds,
  onSelect,
  onMove,
}: {
  document: LabelDocument;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onMove: (id: string, dxMm: number, dyMm: number) => void;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-border bg-muted/40 p-6">
      <div
        aria-label="Label canvas"
        className="relative shrink-0 overflow-hidden bg-white text-black shadow-sm"
        style={{ width: document.page.widthMm * SCALE, height: document.page.heightMm * SCALE }}
      >
        {document.elements.map((element) => {
          const selected = selectedIds.includes(element.id);
          return (
            <button
              aria-label={`${element.type} ${element.id}`}
              className={`absolute flex items-center justify-center overflow-hidden border text-left text-[10px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-blue-500 bg-blue-50" : "border-transparent hover:border-slate-300"}`}
              data-testid={`element-${element.id}`}
              key={element.id}
              onClick={() => onSelect(element.id)}
              onFocus={() => onSelect(element.id)}
              onKeyDown={(event) => {
                const distance = event.shiftKey ? 1 : 0.25;
                if (event.key === "ArrowLeft") { event.preventDefault(); onMove(element.id, -distance, 0); }
                if (event.key === "ArrowRight") { event.preventDefault(); onMove(element.id, distance, 0); }
                if (event.key === "ArrowUp") { event.preventDefault(); onMove(element.id, 0, -distance); }
                if (event.key === "ArrowDown") { event.preventDefault(); onMove(element.id, 0, distance); }
              }}
              style={{
                left: element.xMm * SCALE,
                top: element.yMm * SCALE,
                width: Math.max((element.widthMm ?? element.heightMm ?? 10) * SCALE, 4),
                height: Math.max((element.heightMm ?? element.widthMm ?? 5) * SCALE, 4),
                transform: `rotate(${element.rotation}deg)`,
                fontSize: element.fontSizeMm ? Math.max(element.fontSizeMm * 1.4, 8) : undefined,
              }}
              type="button"
            >
              {elementLabel(element)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
