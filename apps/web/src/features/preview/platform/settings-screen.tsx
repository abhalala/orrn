import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { Input } from "@orrn/ui/components/input";
import { Tabs } from "@orrn/ui/components/tabs";
import { useEffect, useState } from "react";

import { PlatformLinks, useChrome } from "./chrome";
import {
  BACKUP_DRILL,
  BACKUP_EXPORT,
  bandLabel,
  BHAVESH_ORDER,
  BOUGHT_MODULES,
  checkShifts,
  cloneShifts,
  collapsedWeightG,
  confirmOrder,
  DEMO_LICENCE_LABEL,
  DIES,
  dragNightStartTo0700,
  DRILL_RERUN,
  FLOOR_BUNDLES,
  formatClock,
  formatInrPaise,
  formatKgPer12,
  formatMegabytes,
  formatRatePerKg,
  lineTotalPaise,
  pairBlank,
  rangeEndLabel,
  RATE_PAISE_PER_KG,
  SAVED_SHIFTS,
  shift1,
  STANDARDS,
  type Attachment,
  type Shift,
  type StandardPair,
} from "./fixtures";
import { updatePlatformPreviewState, usePlatformPreviewState } from "./state";

const SAMPLE_DIE = DIES[0];
const SAMPLE_DISPATCH = FLOOR_BUNDLES.find((bundle) => bundle.packingList === "PL/2026-27/18");

export function SettingsScreen() {
  const chrome = useChrome();
  const [tab, setTab] = useState("shifts");

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PlatformLinks current="settings" />
      <Tabs
        label="Settings"
        value={tab}
        onValueChange={setTab}
        items={[
          { id: "shifts", label: "Shifts" },
          { id: "modules", label: "Modules" },
          { id: "standards", label: "Standards" },
          { id: "backup", label: "Backup" },
        ]}
      >
        {tab === "shifts" ? <ShiftsTab dayName={chrome.day} nightName={chrome.night} /> : null}
        {tab === "modules" ? <ModulesTab /> : null}
        {tab === "standards" ? <StandardsTab /> : null}
        {tab === "backup" ? <BackupTab /> : null}
      </Tabs>
      <p className="m-0 text-[13px] text-muted-foreground">Preview only. Nothing on this screen is written to the plant.</p>
    </div>
  );
}

function ShiftsTab({ dayName, nightName }: { dayName: string; nightName: string }) {
  const [shifts, setShifts] = useState<Shift[]>(() => cloneShifts());
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const check = checkShifts(shifts);
  const overlapped = shifts.some((shift, index) => {
    const saved = SAVED_SHIFTS[index];
    return saved !== undefined && (shift.startMin !== saved.startMin || shift.endMin !== saved.endMin);
  });
  const first = shift1(shifts);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">
        {first
          ? `Shift ${first.seq} (${first.name === "Day" ? dayName : nightName}) starts the production day at ${formatClock(first.startMin)}.`
          : "No shift is seq 1."}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {shifts.map((shift) => (
          <Card key={shift.id}>
            <CardHeader>
              <CardTitle>{shift.name === "Day" ? dayName : shift.name === "Night" ? nightName : shift.name}</CardTitle>
              <CardDescription>seq {shift.seq}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="m-0 font-mono text-[20px] font-semibold tabular-nums">
                {formatClock(shift.startMin)}–{formatClock(shift.endMin)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={overlapped}
          onClick={() => {
            setShifts(dragNightStartTo0700(shifts));
            setSavedNote(null);
          }}
        >
          Start Night at 07:00
        </Button>
        {overlapped ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setShifts(cloneShifts());
              setSavedNote(null);
            }}
          >
            Restore Day and Night
          </Button>
        ) : null}
      </div>
      {check.issues.length > 0 ? (
        <div id="shift-errors" role="alert" className="flex flex-col gap-2 rounded-card border border-border bg-surface-sunken p-4">
          {check.issues.map((issue) => (
            <p key={`${issue.kind}-${issue.from}`} className="m-0 text-[15px] leading-6">
              {issue.kind === "overlap"
                ? `Overlap from ${formatClock(issue.from)} to ${rangeEndLabel(issue.to)} (${issue.minutes.toLocaleString("en-IN")} min). Night starts at ${formatClock(shifts.find((shift) => shift.name === "Night")?.startMin ?? 7 * 60)} while Day still ends at ${formatClock(shifts.find((shift) => shift.name === "Day")?.endMin ?? 20 * 60)}.`
                : `Gap from ${formatClock(issue.from)} to ${rangeEndLabel(issue.to)} (${issue.minutes.toLocaleString("en-IN")} min). Shifts must cover 24 hours with no overlap.`}
            </p>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[15px] text-muted-foreground" role="status">
          24 hours covered. No overlap. Touching at 08:00 and 20:00 is allowed.
        </p>
      )}
      {savedNote ? (
        <p className="m-0 text-[15px]" role="status">
          {savedNote}
        </p>
      ) : null}
      <FormActions>
        <Button
          type="button"
          disabled={!check.ok}
          aria-describedby={check.ok ? undefined : "shift-errors"}
          onClick={() => setSavedNote("Shifts cover 24 hours. Nothing is written to the plant.")}
        >
          Save
        </Button>
      </FormActions>
    </div>
  );
}

function ModulesTab() {
  const switches = usePlatformPreviewState();
  const [attachment, setAttachment] = useState<Attachment>("none");
  const [confirm, setConfirm] = useState<{ ok: boolean; message: string } | null>(null);
  const die = SAMPLE_DIE;
  const dispatchGrams = SAMPLE_DISPATCH?.grams ?? 0;
  const totalPaise = lineTotalPaise(dispatchGrams, RATE_PAISE_PER_KG);
  const single = collapsedWeightG(die?.weightMinG ?? 0, die?.weightMaxG ?? 0);

  useEffect(() => {
    setConfirm(null);
  }, [switches.dieRequiredOnSalesOrder, attachment]);

  if (!die) return null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Bought modules</CardTitle>
          <CardDescription>Read-only. Platform staff set these. An empty list would mean all on; this plant has a list.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {BOUGHT_MODULES.map((mod) => (
              <li key={mod.id}>
                <Chip tone={mod.on ? "green" : "neutral"}>{mod.on ? mod.label : `${mod.label} off`}</Chip>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign-in</CardTitle>
          <CardDescription>Second factor stays authenticator TOTP. This form has no IP range and no router key.</CardDescription>
        </CardHeader>
      </Card>

      <SwitchRow
        label="Die bands"
        hint="Off hides the band and the band-start basis. The stored grams are not rewritten."
        on={switches.dieBands}
        onToggle={() => updatePlatformPreviewState({ dieBands: !switches.dieBands })}
      />
      <SwitchRow
        label="Price on the sales order"
        hint="On shows ₹/kg to staff who hold the price action. The party portal never shows a rate."
        on={switches.priceOnSalesOrder}
        onToggle={() => updatePlatformPreviewState({ priceOnSalesOrder: !switches.priceOnSalesOrder })}
      />
      <SwitchRow
        label="Die required"
        hint="On: office confirm needs a die copy or a tier. Off: confirm may proceed on the section alone."
        on={switches.dieRequiredOnSalesOrder}
        onToggle={() => updatePlatformPreviewState({ dieRequiredOnSalesOrder: !switches.dieRequiredOnSalesOrder })}
      />

      <Card>
        <CardHeader>
          <CardTitle>Staff sample</CardTitle>
          <CardDescription>
            {BHAVESH_ORDER.series} {BHAVESH_ORDER.section} · {BHAVESH_ORDER.lengthFt} ft · packing list PL/2026-27/18
          </CardDescription>
        </CardHeader>
        <CardContent>
          {switches.dieBands ? (
            <div className="flex flex-col gap-1">
              <p className="m-0 font-mono text-[15px] tabular-nums">{bandLabel(die.weightMinG, die.weightMaxG)} kg/12 ft</p>
              <p className="m-0 text-[13px] text-muted-foreground">
                Band start {formatKgPer12(die.weightMinG)} kg/12 ft
              </p>
            </div>
          ) : (
            <p className="m-0 font-mono text-[15px] tabular-nums">{formatKgPer12(single)} kg/12 ft</p>
          )}
          {switches.priceOnSalesOrder ? (
            <p className="m-0 text-[15px] tabular-nums">
              {formatRatePerKg(RATE_PAISE_PER_KG)} · dispatch total {formatInrPaise(totalPaise)}
            </p>
          ) : (
            <p className="m-0 text-[15px] text-muted-foreground">Price is off. No rate and no dispatch total.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Office confirm</CardTitle>
          <CardDescription>Section Domal 12170. The party does not pick the copy.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="m-0 text-[15px]">
            Attached:{" "}
            {attachment === "copy" ? "die copy 12170-1" : attachment === "tier" ? "tier T2" : "section only"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={attachment === "copy" ? "primary" : "secondary"} onClick={() => setAttachment("copy")}>
              Attach copy 12170-1
            </Button>
            <Button type="button" variant={attachment === "tier" ? "primary" : "secondary"} onClick={() => setAttachment("tier")}>
              Attach tier T2
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAttachment("none")}>
              Clear
            </Button>
          </div>
          {confirm ? (
            <p className="m-0 text-[15px]" role={confirm.ok ? "status" : "alert"}>
              {confirm.message}
            </p>
          ) : null}
        </CardContent>
        <FormActions>
          <Button type="button" onClick={() => setConfirm(confirmOrder(switches.dieRequiredOnSalesOrder, attachment))}>
            Confirm
          </Button>
        </FormActions>
      </Card>
    </div>
  );
}

function SwitchRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-5">
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold">{label}</p>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{hint}</p>
      </div>
      <Button type="button" variant={on ? "primary" : "secondary"} aria-pressed={on} onClick={onToggle}>
        {on ? "On" : "Off"}
      </Button>
    </div>
  );
}

function StandardsTab() {
  const [pairs, setPairs] = useState(STANDARDS);

  const setKind = (kind: keyof typeof STANDARDS, patch: Partial<StandardPair>) => {
    setPairs((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">
        Printed on the label and the test certificate for the die&apos;s profile kind. A blank CM/L prints no licence line.
      </p>
      {(["solid", "hollow", "semi"] as const).map((kind) => {
        const pair = pairs[kind];
        return (
          <Card key={kind}>
            <CardHeader>
              <CardTitle className="capitalize">{kind}</CardTitle>
              {kind === "semi" && pairBlank(pair) ? <CardDescription>Uses solid until set</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Standard" hint="Max 40 characters.">
                  <Input
                    value={pair.standard}
                    maxLength={40}
                    onChangeText={(standard) => setKind(kind, { standard })}
                  />
                </Field>
                <Field label="CM/L" hint={pair.cml.trim() === "" ? "Blank prints no licence line." : DEMO_LICENCE_LABEL}>
                  <Input value={pair.cml} maxLength={40} onChangeText={(cml) => setKind(kind, { cml })} className="font-mono" />
                </Field>
              </div>
              {pair.cml.trim() !== "" ? (
                <Badge tone="warning">{DEMO_LICENCE_LABEL}</Badge>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function BackupTab() {
  const [drill, setDrill] = useState<"saved" | "running" | "ok">("saved");

  useEffect(() => {
    if (drill !== "running") return;
    const id = window.setTimeout(() => setDrill("ok"), 800);
    return () => window.clearTimeout(id);
  }, [drill]);

  const drillLine =
    drill === "running"
      ? "Drill running"
      : drill === "ok"
        ? `Drill ok · ${DRILL_RERUN.at} · scratch plant ${DRILL_RERUN.scratch}`
        : `Drill ok · ${BACKUP_DRILL.at} · scratch plant ${BACKUP_DRILL.scratch}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>Status only. No folder path, no download, no secret.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="m-0 text-[15px]" role="status">
            Export {BACKUP_EXPORT.status} · {BACKUP_EXPORT.at} · {formatMegabytes(BACKUP_EXPORT.bytes)}
          </p>
          <p className="m-0 text-[15px]" role="status" aria-busy={drill === "running"}>
            {drillLine}
          </p>
        </CardContent>
        <FormActions>
          <Button type="button" disabled={drill === "running"} onClick={() => setDrill("running")}>
            {drill === "running" ? "Running" : "Run drill"}
          </Button>
        </FormActions>
      </Card>
    </div>
  );
}
