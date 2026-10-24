import { Button } from "@orrn/ui/components/button";
import { Sheet } from "@orrn/ui/components/sheet";
import { useState } from "react";

import { BandPositionChip, PercentChip } from "./drift-chips";
import {
  bandPosition,
  driftTone,
  formatKgPerM,
  formatMilliKg,
  formatPctTenth,
  parseKgToMilli,
  pctTenth,
  type Band,
} from "./fixtures";

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"] as const;

export function ReadingPad({
  open,
  onOpenChange,
  lastMilli,
  band,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastMilli: number | null;
  band: Band;
  onAdd: (milli: number) => void;
}) {
  const [text, setText] = useState("");
  const parsed = parseKgToMilli(text);
  const preview =
    parsed !== null && parsed >= 1
      ? {
          tenth: pctTenth(parsed, band.weightMinG),
          tone: driftTone(parsed, band.weightMinG),
          position: bandPosition(parsed, band),
          kgPerM: formatKgPerM(parsed),
        }
      : null;

  const push = (key: string) => {
    setText((prev) => {
      if (key === "back") return prev.slice(0, -1);
      if (key === "." && prev.includes(".")) return prev;
      const next = prev + key;
      if (!/^\d{0,4}(\.\d{0,3})?$/.test(next)) return prev;
      return next;
    });
  };

  const close = () => {
    setText("");
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setText("");
        onOpenChange(next);
      }}
      title="Add reading"
      description={
        lastMilli === null
          ? "kg per 12 ft. No reading yet."
          : `kg per 12 ft. Last reading ${formatMilliKg(lastMilli)}.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (parsed === null || parsed < 1) return;
              onAdd(parsed);
              setText("");
              onOpenChange(false);
            }}
            disabled={parsed === null || parsed < 1}
          >
            Add reading
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 font-mono text-[40px] font-semibold leading-none tabular-nums" aria-live="polite">
          {text || "0"}
          <span className="ml-2 text-[15px] font-medium text-muted-foreground">kg/12 ft</span>
        </p>
        {preview ? (
          <div className="flex flex-wrap items-center gap-2">
            <PercentChip tone={preview.tone} label={formatPctTenth(preview.tenth)} />
            <BandPositionChip position={preview.position} />
            <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{preview.kgPerM} kg/m</span>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">Enter the weight. One to three decimal places.</p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <Button key={key} variant="secondary" onClick={() => push(key)} aria-label={key === "back" ? "Backspace" : key}>
              {key === "back" ? "⌫" : key}
            </Button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
