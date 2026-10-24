import type { FileRouteTypes } from "@/routeTree.gen";
import { previewModule } from "@/features/preview/registry";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Dialog } from "@orrn/ui/components/dialog";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { SECTION, formatBand } from "../fixtures";
import {
  resetPressDemo,
  setNothingReleased,
  setSecondReportRow,
  setViewer,
  showCounting,
  showRunning,
  stopPreview,
  usePressDemo,
} from "../store";

const mod = previewModule("press")!;

const LINKS = [
  { id: "board", label: "Line board", to: "/preview/press" },
  { id: "station", label: "Station", to: "/preview/press/console" },
  { id: "report", label: "Report", to: "/preview/press/report" },
  { id: "summary", label: "Summary", to: "/preview/press/summary" },
] as const satisfies readonly { id: string; label: string; to: FileRouteTypes["to"] }[];

export type PressScreenId = (typeof LINKS)[number]["id"];

export function PressScreen({
  title,
  summary,
  featureIds,
  children,
}: {
  title: string;
  summary: string;
  featureIds: string[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PreviewFrame
      title={title}
      summary={summary}
      featureIds={featureIds}
      specPath={mod.specPath}
      actions={
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Sample data
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-5">{children}</div>
      <SampleDataDrawer open={open} onOpenChange={setOpen} />
    </PreviewFrame>
  );
}

export function ScreenLinks({ current }: { current: PressScreenId }) {
  return (
    <nav aria-label="Press screens" className="flex flex-wrap gap-2">
      {LINKS.map((link) => {
        const here = link.id === current;
        const currentPage = here ? "page" : undefined;
        if (link.id === "station") {
          return (
            <Button key={link.id} asChild variant={here ? "secondary" : "ghost"} size="md">
              <Link to={link.to} search={{ run: "PR-42" }} aria-current={currentPage}>
                {link.label}
              </Link>
            </Button>
          );
        }
        return (
          <Button key={link.id} asChild variant={here ? "secondary" : "ghost"} size="md">
            <Link to={link.to} aria-current={currentPage}>
              {link.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

export function SampleDataDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const demo = usePressDemo();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Sample data"
      description="Sample switches for screenshots. Nothing is saved."
      footer={
        <Button variant="secondary" onClick={resetPressDemo}>
          Reset demo
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <label className="flex items-start gap-3">
          <Checkbox
            className="mt-0.5"
            checked={demo.nothingReleased}
            onCheckedChange={(checked) => setNothingReleased(checked === true)}
          />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Nothing released</span>
            <span className="block text-[13px] leading-5 text-muted-foreground">
              Hides the queue on the line board. The empty state is not the default.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <Checkbox
            className="mt-0.5"
            checked={demo.showSecondReportRow}
            onCheckedChange={(checked) => setSecondReportRow(checked === true)}
          />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Night run on the report</span>
            <span className="block text-[13px] leading-5 text-muted-foreground">
              Adds PR-38 so the sheet has two rows. Longest stops stay on the summary.
            </span>
          </span>
        </label>
        {demo.pr42.phase !== "logged" ? (
          <SegmentedControl
            label="PR-42 station screen"
            value={demo.pr42.phase === "running" ? "running" : demo.pr42.phase === "stopped" ? "stopped" : "counting"}
            onChange={(value) => {
              if (value === "running") showRunning();
              else if (value === "stopped") stopPreview();
              else showCounting();
            }}
            options={[
              { value: "counting", label: "Counting" },
              { value: "running", label: "Running" },
              { value: "stopped", label: "Stopped" },
            ]}
          />
        ) : null}
        <SegmentedControl
          label="Signed in as"
          value={demo.viewer}
          onChange={setViewer}
          options={[
            { value: "supervisor", label: "Supervisor" },
            { value: "operator", label: "Operator" },
          ]}
        />
        <p className="m-0 text-[14px] leading-6 text-muted-foreground">
          Mahesh can log. Raju waits. The person who requests a reopen cannot approve it.
        </p>
      </div>
    </Sheet>
  );
}

export function DrawingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={SECTION.label}
      description="12170 Domal — drawing not on this demo file"
      actions={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">
        Band {formatBand()}. The press can open the drawing. It cannot upload or replace it. A missing
        file does not lock start.
      </p>
    </Dialog>
  );
}

export function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 mt-0.5 text-[15px] tabular-nums text-foreground", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
