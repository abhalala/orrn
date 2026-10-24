import { Button } from "@orrn/ui/components/button";
import { Card, CardContent } from "@orrn/ui/components/card";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Field } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useMemo, useState } from "react";
import {
  KD_ORDER,
  STOCK_BUNDLES,
  TRANSFER_CODE,
  dieFor,
  formatCount,
  formatKg2,
  kgPer12ftAt,
  lengthRows,
  sectionLabel,
  sectionRows,
  sumKg,
  type Allocation,
  type BundleFixture,
} from "./fixtures";

type View = "sections" | "lengths" | "bundles";
type Target = "plant" | "kd";

export function StockYard() {
  const [view, setView] = useState<View>("lengths");
  const [bundles, setBundles] = useState<BundleFixture[]>(() => STOCK_BUNDLES.map((bundle) => ({ ...bundle })));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [target, setTarget] = useState<Target>("plant");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const [transferCode, setTransferCode] = useState<string | null>(null);

  const yardKg = sumKg(bundles.map((bundle) => bundle.weightKg));
  const openingKg = sumKg(STOCK_BUNDLES.map((bundle) => bundle.weightKg));
  const lengths = lengthRows(bundles);
  const sections = sectionRows(bundles);
  const openBundles = bundles.filter((bundle) => `${bundle.dieCode}:${bundle.lengthFt}` === openKey);

  const selected = useMemo(
    () => bundles.filter((bundle) => checked.includes(bundle.serial)),
    [bundles, checked],
  );

  const openLength = (key: string) => {
    setOpenKey((current) => (current === key ? null : key));
    const inLength = bundles.filter((bundle) => `${bundle.dieCode}:${bundle.lengthFt}` === key);
    setChecked(inLength.map((bundle) => bundle.serial));
    setApproval(null);
  };

  const toggleChecked = (serial: string) => {
    setChecked((current) =>
      current.includes(serial) ? current.filter((item) => item !== serial) : [...current, serial],
    );
  };

  const confirmTransfer = () => {
    if (selected.length === 0) {
      setReasonError("Select a bundle.");
      return;
    }
    if (reason.trim() === "") {
      setReasonError("A transfer needs a reason.");
      return;
    }
    setReasonError(null);
    if (target === "kd") {
      setApproval("Needs a reallocation approval");
      return;
    }
    const moving = new Set(selected.map((bundle) => bundle.serial));
    setBundles((current) =>
      current.map((bundle) =>
        moving.has(bundle.serial)
          ? {
              ...bundle,
              allocation: "plant-stock" satisfies Allocation,
              salesOrderCode: null,
              customer: null,
            }
          : bundle,
      ),
    );
    setTransferCode(TRANSFER_CODE);
    setApproval(null);
    setSheetOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="m-0 text-[15px]">
          Yard{" "}
          <span className="font-mono font-semibold tabular-nums">{formatKg2(yardKg)} kg</span>
          {transferCode ? (
            <span className="text-muted-foreground"> · same as {formatKg2(openingKg)} kg before the transfer</span>
          ) : null}
        </p>
        {transferCode ? (
          <p className="m-0 font-mono text-[15px] font-semibold" role="status">
            {transferCode}
          </p>
        ) : null}
      </div>

      <SegmentedControl
        label="Stock"
        value={view}
        onChange={setView}
        options={[
          { value: "sections", label: "Sections" },
          { value: "lengths", label: "Lengths" },
          { value: "bundles", label: "Bundles" },
        ]}
      />

      {view === "sections" ? (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {sections.map((section) => (
            <li key={section.dieCode}>
              <Card>
                <CardContent className="gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 font-mono text-[17px] font-semibold">
                      {section.dieCode} {section.series}
                    </p>
                    <Chip tone="neutral">{section.profileKind === "hollow" ? "Hollow" : "Solid"}</Chip>
                  </div>
                  <p className="m-0 text-[14px] tabular-nums text-muted-foreground">
                    {formatCount(section.bundles)} {section.bundles === 1 ? "bundle" : "bundles"} · {formatCount(section.pieces)} pcs ·{" "}
                    {formatKg2(section.kg)} kg
                  </p>
                  {section.owner ? (
                    <p className="m-0 text-[13px] text-muted-foreground">Owned by {section.owner}</p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {view === "lengths" ? (
        <div className="flex min-w-0 flex-col gap-3">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {lengths.map((row) => {
              const open = openKey === row.key;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => openLength(row.key)}
                    className={cn(
                      "flex w-full min-w-0 flex-col gap-1 rounded-card border bg-card p-4 text-left shadow-sm transition-colors duration-[var(--dur-fast)]",
                      open ? "border-foreground" : "border-border",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">
                        {row.dieCode} {row.series}
                      </span>
                      <span className="tabular-nums">{row.lengthFt} ft</span>
                      {row.plantStock ? <Chip tone="blue">Plant stock</Chip> : null}
                    </span>
                    <span className="text-[14px] tabular-nums text-muted-foreground">
                      {formatCount(row.bundles)} {row.bundles === 1 ? "bundle" : "bundles"} · {formatCount(row.pieces)} pcs · {formatKg2(row.kg)} kg
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {openKey && openBundles.length > 0 ? (
            <Card>
              <CardContent className="gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="m-0 text-[15px] font-semibold">Bundles</h2>
                  <Button variant="secondary" onPress={() => setSheetOpen(true)}>
                    Transfer
                  </Button>
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {openBundles.map((bundle) => (
                    <BundleRow
                      key={bundle.serial}
                      bundle={bundle}
                      checked={checked.includes(bundle.serial)}
                      onChecked={() => toggleChecked(bundle.serial)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {view === "bundles" ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {bundles.map((bundle) => (
            <li key={bundle.serial} className="rounded-card border border-border bg-card p-4">
              <BundleFacts bundle={bundle} />
            </li>
          ))}
        </ul>
      ) : null}

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Transfer"
        description="Kg stays in the yard. A cross-customer move needs a reallocation approval."
        footer={
          <>
            <Button variant="secondary" onPress={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button onPress={confirmTransfer}>Confirm</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[14px] text-muted-foreground">
            {selected.length === 0
              ? "No bundle selected."
              : selected.map((bundle) => bundle.serial).join(", ")}
            {" · "}
            {formatKg2(sumKg(selected.map((bundle) => bundle.weightKg)))} kg
          </p>
          <Field label="Target">
            <Select
              aria-label="Target"
              value={target}
              onValueChange={(value) => {
                setTarget(value as Target);
                setApproval(null);
              }}
              options={[
                { value: "plant", label: "Plant stock" },
                { value: "kd", label: `KD Extrusion, ${KD_ORDER.code}` },
              ]}
            />
          </Field>
          <Field label="Reason" id="transfer-reason" error={reasonError ?? undefined}>
            <TextArea
              id="transfer-reason"
              value={reason}
              onChangeText={setReason}
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              placeholder="Why these bundles move"
            />
          </Field>
          {approval ? (
            <p role="status" className="m-0 text-[15px] font-semibold">
              {approval}
            </p>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

function BundleRow({
  bundle,
  checked,
  onChecked,
}: {
  bundle: BundleFixture;
  checked: boolean;
  onChecked: () => void;
}) {
  return (
    <li className="flex min-w-0 items-start gap-3">
      <Checkbox checked={checked} onCheckedChange={onChecked} aria-label={`Select ${bundle.serial}`} />
      <div className="min-w-0 flex-1">
        <BundleFacts bundle={bundle} />
      </div>
    </li>
  );
}

function BundleFacts({ bundle }: { bundle: BundleFixture }) {
  const die = dieFor(bundle.dieCode);
  const kg12 = kgPer12ftAt(bundle.weightKg, bundle.pieces, bundle.lengthFt);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{bundle.serial}</span>
        <AllocationChip allocation={bundle.allocation} />
      </div>
      <p className="m-0 text-[13px] text-muted-foreground">
        Party {bundle.partyNo} · {sectionLabel(die)} · {bundle.lengthFt} ft · {bundle.pieces} pcs ·{" "}
        {formatKg2(bundle.weightKg)} kg
        {kg12 !== null ? ` · ${formatKg2(kg12)} kg/12 ft` : ""}
        {bundle.salesOrderCode ? ` · ${bundle.salesOrderCode}` : ""}
        {bundle.yard ? ` · ${bundle.yard}` : ""}
      </p>
    </div>
  );
}

function AllocationChip({ allocation }: { allocation: Allocation }) {
  if (allocation === "plant-stock") return <Chip tone="blue">Plant stock</Chip>;
  if (allocation === "unassigned") return <Chip tone="amber">Unassigned</Chip>;
  return <Chip tone="green">On order</Chip>;
}
