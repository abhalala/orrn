import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { Input } from "@orrn/ui/components/input";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BandPositionChip, PercentChip, StatusChip } from "./drift-chips";
import {
  PLANT,
  SECTIONS,
  allBands,
  bandPosition,
  copyQueryHit,
  driftTone,
  duplicateBandMessage,
  effectiveBand,
  findDuplicateBand,
  formatBandRange,
  formatKgPerM,
  formatMilliKg,
  formatPctTenth,
  formatWallMm,
  latestMilli,
  parseKgToMilli,
  parseWallTenths,
  pctTenth,
  profileLabel,
  sectionMatches,
  suggestFirst,
  type Band,
  type DieCopy,
  type Section,
} from "./fixtures";
import { DieRoomLinks, PreviewLink } from "./screen-links";

const CARD_TO = "/preview/die-room/card";

export function DieRoomBoard() {
  const desktop = useMediaQuery(breakpoints.desktop);
  const [query, setQuery] = useState("");
  const [noCopies, setNoCopies] = useState(false);
  const [added, setAdded] = useState<Band[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [wall, setWall] = useState("");
  const [minKg, setMinKg] = useState("");
  const [maxKg, setMaxKg] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const domal = SECTIONS[0];
  const visible = noCopies ? [] : SECTIONS.filter((section) => sectionMatches(section, query));
  const hit = copyQueryHit(
    query,
    visible.flatMap((section) => section.copies.map((copy) => copy.code)),
  );
  const suggestion = noCopies || !domal ? null : suggestFirst(domal, added);

  useEffect(() => {
    if (!hit) return;
    document.getElementById(`copy-${hit}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hit, desktop, noCopies]);

  const submitBand = () => {
    if (!domal) return;
    const wallTenth = parseWallTenths(wall);
    const minG = parseKgToMilli(minKg);
    const maxG = parseKgToMilli(maxKg);
    if (wallTenth === null) {
      setFormError("Enter the wall in millimetres.");
      return;
    }
    if (minG === null || maxG === null) {
      setFormError("Enter min and max kg per 12 ft.");
      return;
    }
    if (minG < 1) {
      setFormError("Band start is at least 1 g.");
      return;
    }
    if (minG > maxG) {
      setFormError("Min cannot be above max.");
      return;
    }
    const clash = findDuplicateBand(allBands(domal, added), wallTenth, minG, maxG);
    if (clash) {
      const message = duplicateBandMessage(domal, wallTenth, minG, maxG);
      setFormError(message);
      toast.error(message);
      return;
    }
    setAdded((prev) => [
      ...prev,
      {
        id: `added-${wallTenth}-${minG}-${maxG}`,
        label: null,
        wallTenthMm: wallTenth,
        weightMinG: minG,
        weightMaxG: maxG,
        active: true,
        primary: false,
      },
    ]);
    setFormError(null);
    setWall("");
    setMinKg("");
    setMaxKg("");
    setFormOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DieRoomLinks />
      <Toolbar
        actions={
          <Button
            variant={noCopies ? "primary" : "secondary"}
            aria-pressed={noCopies}
            onClick={() => setNoCopies((on) => !on)}
          >
            Show empty state
          </Button>
        }
      >
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search 12170-2"
          aria-label="Search sections and copies"
          inputMode="search"
        />
      </Toolbar>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">
        {PLANT.name}, {PLANT.city}. Slash or hyphen both find a copy — 12170/2 is 12170-2.
      </p>

      {suggestion ? (
        <p
          role="status"
          className="m-0 rounded-card border border-border bg-tone-green-tint px-4 py-3 text-[15px] font-semibold leading-6 text-tone-green-ink"
        >
          Run {suggestion.copy.code} first — {formatMilliKg(suggestion.latest)} kg/12 ft, in band.
        </p>
      ) : null}

      {noCopies && domal ? (
        <Card>
          <SectionHeading section={domal} onAddBand={() => setFormOpen(true)} addBand={false} />
          <EmptyState
            title="No copies yet"
            body="No copies yet. The oblique number is assigned when you add one."
          />
        </Card>
      ) : null}

      {!noCopies && visible.length === 0 ? (
        <EmptyState title="Nothing matches" body="Try a section code, a series, or a copy code." />
      ) : null}

      {!noCopies && desktop ? (
        <SectionTable
          sections={visible}
          added={added}
          hit={hit}
          formOpen={formOpen}
          onAddBand={() => {
            setFormError(null);
            setFormOpen(true);
          }}
        />
      ) : null}

      {!noCopies && !desktop ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((section) => (
            <Card key={section.id} className="min-w-0">
              <SectionHeading
                section={section}
                addBand={section.sectionCode === "12170"}
                onAddBand={() => {
                  setFormError(null);
                  setFormOpen(true);
                }}
              />
              <BandChips section={section} added={section.sectionCode === "12170" ? added : []} />
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {section.copies.map((copy) => (
                  <li key={copy.id}>
                    <CopyRow section={section} copy={copy} added={added} hit={hit === copy.code} />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}

      {formOpen && domal ? (
        <Card>
          <CardTitle>Add band · 12170 Domal</CardTitle>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            A second copy is always allowed. A second band with the same wall and range is not.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Wall" hint="Millimetres">
              <NumberInput value={wall} onValueChange={setWall} suffix="mm" />
            </Field>
            <Field label="Min" hint="kg per 12 ft">
              <NumberInput value={minKg} onValueChange={setMinKg} suffix="kg" />
            </Field>
            <Field label="Max" hint="kg per 12 ft">
              <NumberInput value={maxKg} onValueChange={setMaxKg} suffix="kg" />
            </Field>
          </div>
          {formError ? (
            <p role="status" className="m-0 text-[13px] font-medium leading-5 text-destructive">
              {formError}
            </p>
          ) : null}
          <FormActions>
            <Button
              variant="secondary"
              onClick={() => {
                setFormOpen(false);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitBand}>Save band</Button>
          </FormActions>
        </Card>
      ) : null}
    </div>
  );
}

function SectionHeading({
  section,
  addBand,
  onAddBand,
}: {
  section: Section;
  addBand: boolean;
  onAddBand: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m-0 font-mono text-[20px] font-semibold tabular-nums tracking-[-0.02em]">{section.sectionCode}</h2>
        <p className="m-0 text-[14px] leading-5 text-muted-foreground">
          {section.series} · {profileLabel(section.profileKind)} · {section.alloy} {section.temper}
        </p>
        <p className="m-0 mt-1 text-[13px] leading-5">
          {section.ownerName ? (
            <span className="font-semibold">{section.ownerName}</span>
          ) : (
            <span className="text-muted-foreground">Plant-owned</span>
          )}
          {section.ownerCity ? <span className="text-muted-foreground">, {section.ownerCity}</span> : null}
        </p>
      </div>
      {addBand ? (
        <Button variant="secondary" onClick={onAddBand}>
          Add band
        </Button>
      ) : null}
    </div>
  );
}

function BandChips({ section, added }: { section: Section; added: Band[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {allBands(section, added).map((band) => (
        <Badge key={band.id} tone="neutral" className="font-mono tabular-nums">
          {formatWallMm(band.wallTenthMm)} mm · {formatBandRange(band)} kg/12 ft
          {band.label ? ` (${band.label})` : ""}
          {band.primary ? " · primary" : ""}
        </Badge>
      ))}
    </div>
  );
}

function CopyRow({
  section,
  copy,
  added,
  hit,
}: {
  section: Section;
  copy: DieCopy;
  added: Band[];
  hit: boolean;
}) {
  const band = effectiveBand(section, copy, added);
  const latest = latestMilli(copy);
  const position = bandPosition(latest, band);
  const tone = driftTone(latest, band.weightMinG);
  const tenth = latest === null ? null : pctTenth(latest, band.weightMinG);
  const extra =
    copy.code === "12170-2"
      ? ({ to: "/preview/die-room/lift", label: "Lift" } as const)
      : copy.code === "12170-3"
        ? ({ to: "/preview/die-room/maker", label: "Maker" } as const)
        : copy.code === "31220-1"
          ? ({ to: "/preview/die-room/maker", label: "Owner" } as const)
          : null;

  return (
    <div
      id={`copy-${copy.code}`}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface-sunken p-3",
        hit && "ring-2 ring-foreground",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PreviewLink
          to={CARD_TO}
          className="inline-flex min-h-11 items-center font-mono text-[15px] font-semibold tabular-nums text-foreground no-underline"
        >
          {copy.code}
        </PreviewLink>
        <StatusChip status={copy.status} />
        <span className="text-[13px] text-muted-foreground">Tier {copy.tierRank}</span>
        {extra ? (
          <PreviewLink to={extra.to} className="relative z-10 ml-auto text-[13px] font-semibold text-foreground">
            {extra.label}
          </PreviewLink>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-mono text-[14px] tabular-nums">
          {latest === null ? "No reading" : `${formatMilliKg(latest)} kg/12 ft`}
        </span>
        {latest !== null ? (
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{formatKgPerM(latest)} kg/m</span>
        ) : null}
        {tenth !== null ? <PercentChip tone={tone} label={formatPctTenth(tenth)} /> : null}
        <BandPositionChip position={position} />
      </div>
    </div>
  );
}

function SectionTable({
  sections,
  added,
  hit,
  formOpen,
  onAddBand,
}: {
  sections: Section[];
  added: Band[];
  hit: string | null;
  formOpen: boolean;
  onAddBand: () => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card">
      <table className="w-full border-collapse text-[14px]" aria-label="Dies">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="px-4 py-3 font-semibold text-muted-foreground">
              Section
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-muted-foreground">
              Band
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-muted-foreground">
              Owner
            </th>
            <th scope="col" className="px-4 py-3 font-semibold text-muted-foreground">
              Copies
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <tr key={section.id} className="border-b border-border align-top last:border-0">
              <td className="min-w-[140px] px-4 py-4">
                <div className="font-mono text-[16px] font-semibold tabular-nums">{section.sectionCode}</div>
                <div className="text-[13px] text-muted-foreground">
                  {section.series} · {profileLabel(section.profileKind)}
                </div>
                <div className="text-[13px] text-muted-foreground">
                  {section.alloy} {section.temper}
                </div>
                {section.sectionCode === "12170" ? (
                  <Button variant="secondary" className="mt-3" onClick={onAddBand} aria-expanded={formOpen}>
                    Add band
                  </Button>
                ) : null}
              </td>
              <td className="min-w-[180px] px-4 py-4">
                <BandChips section={section} added={section.sectionCode === "12170" ? added : []} />
              </td>
              <td className="px-4 py-4">
                {section.ownerName ? (
                  <span className="font-semibold">{section.ownerName}</span>
                ) : (
                  <span className="text-muted-foreground">Plant-owned</span>
                )}
              </td>
              <td className="min-w-[280px] px-4 py-4">
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {section.copies.map((copy) => (
                    <li key={copy.id}>
                      <CopyRow section={section} copy={copy} added={added} hit={hit === copy.code} />
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
