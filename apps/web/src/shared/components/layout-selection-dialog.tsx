import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Label } from "@orrn/ui/components/label";
import { Select } from "@orrn/ui/components/select";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { useState } from "react";

const LAYOUTS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export function LayoutSelectionDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Select label layout",
  profileOptions,
  profileId,
  onProfileIdChange,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (layout: string) => void;
  title?: string;
  profileOptions?: Array<{ label: string; value: string }>;
  profileId?: string;
  onProfileIdChange?: (profileId: string) => void;
  loading?: boolean;
}) {
  const [selectedLayout, setSelectedLayout] = useState<(typeof LAYOUTS)[number]>("0");

  const currentIndex = LAYOUTS.indexOf(selectedLayout);
  const previous = () => setSelectedLayout(LAYOUTS[currentIndex === 0 ? LAYOUTS.length - 1 : currentIndex - 1]);
  const next = () => setSelectedLayout(LAYOUTS[(currentIndex + 1) % LAYOUTS.length]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Choose the Nexus/Bartender layout slot for this label print."
      maxWidth={520}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(`x${selectedLayout}`)} disabled={loading || (profileOptions && !profileId)}>
            <Printer className="mr-2 size-4" aria-hidden="true" />
            {loading ? "Printing…" : "Print"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {profileOptions && onProfileIdChange ? (
          <div className="space-y-2">
            <Label>Printer profile</Label>
            <Select
              value={profileId ?? ""}
              onValueChange={onProfileIdChange}
              placeholder="Select a printer profile…"
              options={profileOptions}
            />
          </div>
        ) : null}

        <div className="flex items-center justify-center gap-4 rounded-xl border border-border bg-muted/40 p-5">
          <Button variant="outline" size="icon" onClick={previous} disabled={loading}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            <span className="sr-only">Previous layout</span>
          </Button>
          <div className="flex size-24 items-center justify-center rounded-xl border border-primary/40 bg-background font-mono text-4xl font-bold text-primary shadow-sm">
            x{selectedLayout}
          </div>
          <Button variant="outline" size="icon" onClick={next} disabled={loading}>
            <ChevronRight className="size-4" aria-hidden="true" />
            <span className="sr-only">Next layout</span>
          </Button>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {LAYOUTS.map((layout) => (
            <Button
              key={layout}
              variant={selectedLayout === layout ? "default" : "outline"}
              size="sm"
              className="font-mono"
              onClick={() => setSelectedLayout(layout)}
              disabled={loading}
            >
              {layout}
            </Button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
