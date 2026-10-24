import { kgToG, parseDecimal } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field, NumberInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { Input } from "@orrn/ui/components/input";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";
import { StockSheet } from "@/features/preview/orders/components/stock-sheet";
import {
  COMPANY,
  CUSTOMERS,
  DIES,
  basisCaption,
  copyByCode,
  customerName,
  dieByCode,
  formatMilli,
  formatKgShort,
  formatOrderKg,
  orderGrams,
  kgFieldText,
  lightestCopy,
  parseLengthFt,
  poClash,
  quoteLine,
  type Finish,
  type QtyBasis,
  type StockRow,
  type WeightBasis,
} from "@/features/preview/orders/fixtures";
import { requestHold, saveBooking, useOrdersDemo } from "@/features/preview/orders/store";

const mod = previewModule("orders")!;

export const Route = createFileRoute("/_tenant/preview/orders/new")({
  component: NewSalesOrderPreview,
});

function NewSalesOrderPreview() {
  const demo = useOrdersDemo();
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState("bhavesh");
  const [po, setPo] = useState("");
  const [finish, setFinish] = useState<Finish>("none");
  const [sectionCode, setSectionCode] = useState("4521");
  const [copyCode, setCopyCode] = useState("4521-1");
  const [feet, setFeet] = useState("18");
  const [inches, setInches] = useState("");
  const [pcsText, setPcsText] = useState("");
  const [kgText, setKgText] = useState("");
  const [qtyBasis, setQtyBasis] = useState<QtyBasis | null>(null);
  const [weightBasis, setWeightBasis] = useState<WeightBasis>("copy_current");
  const [alloy, setAlloy] = useState("6063");
  const [temper, setTemper] = useState("T6");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [planRest, setPlanRest] = useState(false);

  const die = dieByCode(sectionCode) ?? DIES[1]!;
  const copy = copyByCode(die, copyCode) ?? null;
  const lengthFt = parseLengthFt(feet, inches);
  const pcs = parseDecimal(pcsText);
  const kg = parseDecimal(kgText);
  const quote =
    lengthFt == null || qtyBasis == null
      ? null
      : quoteLine({
          qtyBasis,
          pcs: pcs ?? 0,
          kgG: kg == null ? 0 : kgToG(kg),
          lengthFt,
          weightBasis,
          bandStartMilli: die.bandStartMilli,
          copyMilli: copy?.currentMilli ?? null,
        });
  const clash = poClash(demo.orders, customerId, po);
  const ownerId = copy?.ownerCustomerId ?? null;
  const foreignOwner = ownerId != null && ownerId !== customerId;
  const shownPcs = qtyBasis === "kg" && pcs != null && pcs >= 1 ? Math.round(pcs) : (quote?.pcs ?? 0);
  const shownImplied = quote && lengthFt != null ? orderGrams(shownPcs, lengthFt, quote.basisMilli) : 0;
  const gap = quote && qtyBasis === "kg" ? quote.kgG - shownImplied : 0;

  function fillDerived(nextBasis: QtyBasis, nextPcs: string, nextKg: string, nextWeight: WeightBasis, nextFeet: string, nextInches: string, nextDie = die, nextCopy = copy) {
    const nextLength = parseLengthFt(nextFeet, nextInches);
    if (nextLength == null) return;
    if (nextBasis === "pcs") {
      const typed = parseDecimal(nextPcs);
      if (typed == null) {
        setKgText("");
        return;
      }
      const next = quoteLine({
        qtyBasis: "pcs",
        pcs: typed,
        kgG: 0,
        lengthFt: nextLength,
        weightBasis: nextWeight,
        bandStartMilli: nextDie.bandStartMilli,
        copyMilli: nextCopy?.currentMilli ?? null,
      });
      setKgText(next ? kgFieldText(next.kgG) : "");
      return;
    }
    const typedKg = parseDecimal(nextKg);
    if (typedKg == null) {
      setPcsText("");
      return;
    }
    const next = quoteLine({
      qtyBasis: "kg",
      pcs: 0,
      kgG: kgToG(typedKg),
      lengthFt: nextLength,
      weightBasis: nextWeight,
      bandStartMilli: nextDie.bandStartMilli,
      copyMilli: nextCopy?.currentMilli ?? null,
    });
    setPcsText(next ? String(next.pcs) : "");
  }

  function openStockIfReady(nextFeet = feet, nextInches = inches) {
    if (parseLengthFt(nextFeet, nextInches) == null) return;
    setHoldError(null);
    setSheetOpen(true);
  }

  function onPcs(text: string) {
    setPcsText(text);
    setQtyBasis(text.trim() === "" ? null : "pcs");
    setErrors((current) => ({ ...current, pcs: "" }));
    if (text.trim() === "") {
      setKgText("");
      return;
    }
    fillDerived("pcs", text, kgText, weightBasis, feet, inches);
  }

  function onKg(text: string) {
    setKgText(text);
    setQtyBasis(text.trim() === "" ? null : "kg");
    setErrors((current) => ({ ...current, pcs: "" }));
    if (text.trim() === "") {
      setPcsText("");
      return;
    }
    fillDerived("kg", pcsText, text, weightBasis, feet, inches);
  }

  function onWeight(next: WeightBasis) {
    setWeightBasis(next);
    if (qtyBasis) fillDerived(qtyBasis, pcsText, kgText, next, feet, inches);
  }

  function onDie(code: string) {
    const nextDie = dieByCode(code);
    if (!nextDie) return;
    const nextCopy = lightestCopy(nextDie);
    setSectionCode(code);
    setCopyCode(nextCopy.code);
    setAlloy(nextDie.alloy);
    setTemper(nextDie.temper);
    if (qtyBasis) fillDerived(qtyBasis, pcsText, kgText, weightBasis, feet, inches, nextDie, nextCopy);
    openStockIfReady();
  }

  function onCopy(code: string) {
    const nextCopy = copyByCode(die, code) ?? null;
    setCopyCode(code);
    if (qtyBasis) fillDerived(qtyBasis, pcsText, kgText, weightBasis, feet, inches, die, nextCopy);
  }

  function setQuickLength(ft: number) {
    const nextFeet = String(ft);
    setFeet(nextFeet);
    setInches("");
    if (qtyBasis) fillDerived(qtyBasis, pcsText, kgText, weightBasis, nextFeet, "");
    openStockIfReady(nextFeet, "");
  }

  function nudge(delta: number) {
    if (qtyBasis !== "kg" || quote == null) return;
    const base = pcs != null && pcs >= 1 ? Math.round(pcs) : quote.pcs;
    const next = base + delta;
    if (next < 1) return;
    setPcsText(String(next));
  }

  function onHold(row: StockRow | null) {
    if (!row) {
      setHoldError("Hold needs the same die and length. Switch this line to 12 ft for PO AN-1842.");
      return;
    }
    requestHold({ kgG: row.kgG, pcs: row.pcs, po: "AN-1842", fromOrder: "SO-12" });
    setHoldError(null);
    setSheetOpen(false);
  }

  function onSave() {
    const nextErrors: Record<string, string> = {};
    if (lengthFt == null) nextErrors.length = "Enter a cut length.";
    if (!alloy.trim()) nextErrors.alloy = "Enter an alloy.";
    if (!temper.trim()) nextErrors.temper = "Enter a temper.";
    if (pcsText.trim() === "0" || (qtyBasis === "pcs" && pcs != null && pcs < 1)) {
      nextErrors.pcs = "Pieces must be at least 1.";
    }
    if (Object.keys(nextErrors).length > 0 || !quote || qtyBasis == null) {
      setErrors(nextErrors);
      return;
    }
    const number = saveBooking({
      customerId,
      poNumber: po,
      finish,
      holdNote: demo.holdPending
        ? `Hold requested · pending approval · ${formatOrderKg(demo.holdPending.kgG)} kg on ${demo.holdPending.po}`
        : planRest
          ? "Plan only the rest. Yard stock was left where it is."
          : null,
      line: {
        sectionCode: die.code,
        copyCode: copy?.code ?? null,
        cutLengthFt: lengthFt ?? 0,
        qtyBasis,
        pcs: shownPcs,
        kgG: quote.kgG,
        impliedG: shownImplied,
        weightBasis,
        basisMilli: quote.basisMilli,
        bandStartMilli: die.bandStartMilli,
        copyMilli: copy?.currentMilli ?? null,
        alloy: alloy.trim(),
        temper: temper.trim(),
      },
    });
    void navigate({ to: "/preview/orders/$id", params: { id: number } });
  }


  return (
    <PreviewFrame
      title="New sales order"
      summary="Book a party's PO. Confirm is the next step, after the PO number is filled."
      featureIds={["FP-OP-01", "FP-OP-02", "FP-OP-03", "FP-OP-04", "FP-OP-09", "FP-OP-10", "FP-OP-17"]}
      specPath={mod.specPath}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Party</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Customer">
              <Select
                value={customerId}
                onValueChange={setCustomerId}
                options={CUSTOMERS.map((customer) => ({
                  value: customer.id,
                  label: `${customer.name}, ${customer.city}`,
                }))}
                aria-label="Customer"
              />
            </Field>
            <Field
              label="Customer PO"
              hint={clash ? `${clash.poNumber} is already on ${clash.number}. Confirm will be blocked.` : "Optional until confirm."}
            >
              <Input value={po} onChangeText={setPo} placeholder="Party's PO number" autoComplete="off" />
            </Field>
            <Field label="Finish">
              <Select
                value={finish}
                onValueChange={(value) => setFinish(value as Finish)}
                options={[
                  { value: "none", label: "None" },
                  { value: "anodise", label: "Anodise" },
                  { value: "pvd", label: "PVD" },
                ]}
                aria-label="Finish"
              />
            </Field>
            <p className="m-0 self-end text-[13px] leading-5 text-muted-foreground">
              Order date {COMPANY.todayLabel}. A copy is required before confirm.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Line</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Die" error={errors.die}>
              <Select
                value={sectionCode}
                onValueChange={onDie}
                options={DIES.map((item) => ({
                  value: item.code,
                  label: item.name === item.code ? item.code : `${item.code} ${item.name}`,
                }))}
                aria-label="Die"
              />
            </Field>
            <Field label="Copy" hint={`${formatMilli(die.bandStartMilli)}–${formatMilli(die.bandEndMilli)} kg/12 ft`}>
              <Select
                value={copyCode}
                onValueChange={onCopy}
                options={die.copies.map((item) => ({
                  value: item.code,
                  label: `${item.code}${item.tier ? ` · tier ${item.tier}` : ""} · ${formatMilli(item.currentMilli)} kg/12 ft${
                    item.ownerCustomerId ? ` · owner ${customerName(item.ownerCustomerId)}` : ""
                  }`,
                }))}
                aria-label="Die copy"
              />
            </Field>
            <Field label="Cut length" error={errors.length} hint="Company unit is feet and inches.">
              <div className="flex min-w-0 flex-wrap gap-2">
                <div className="min-w-[8rem] flex-1">
                  <NumberInput
                    value={feet}
                    onValueChange={(text) => {
                      setFeet(text);
                      if (qtyBasis) fillDerived(qtyBasis, pcsText, kgText, weightBasis, text, inches);
                    }}
                    onBlur={() => openStockIfReady()}
                    suffix="ft"
                    decimal={false}
                    aria-label="Feet"
                  />
                </div>
                <div className="min-w-[8rem] flex-1">
                  <NumberInput
                    value={inches}
                    onValueChange={(text) => {
                      setInches(text);
                      if (qtyBasis) fillDerived(qtyBasis, pcsText, kgText, weightBasis, feet, text);
                    }}
                    onBlur={() => openStockIfReady()}
                    suffix="in"
                    aria-label="Inches"
                  />
                </div>
              </div>
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              {[12, 14, 18].map((ft) => (
                <Button
                  key={ft}
                  variant="secondary"
                  aria-pressed={feet === String(ft) && inches.trim() === ""}
                  className={feet === String(ft) && inches.trim() === "" ? "ring-2 ring-foreground" : undefined}
                  onClick={() => setQuickLength(ft)}
                >
                  {ft} ft
                </Button>
              ))}
            </div>
            <Field label="Alloy" error={errors.alloy}>
              <Input value={alloy} onChangeText={setAlloy} autoComplete="off" />
            </Field>
            <Field label="Temper" error={errors.temper}>
              <Input value={temper} onChangeText={setTemper} autoComplete="off" />
            </Field>
            <Field label="Pieces" error={errors.pcs}>
              <NumberInput value={pcsText} onValueChange={onPcs} suffix="pcs" decimal={false} aria-label="Pieces" />
            </Field>
            <Field label="Kg">
              <NumberInput value={kgText} onValueChange={onKg} suffix="kg" aria-label="Kilograms" />
            </Field>
          </div>

          <Button variant="ghost" className="mt-3 self-start" onClick={() => openStockIfReady()}>
            Stock for this die and length
          </Button>

          <div className="mt-3 flex min-w-0 flex-col gap-3">
            <SegmentedControl
              label="Weight basis"
              value={weightBasis}
              onChange={onWeight}
              options={[
                { value: "copy_current", label: "Current" },
                { value: "band_start", label: "Band start" },
              ]}
            />
            <p className="m-0 text-[14px] leading-5 text-muted-foreground">
              {quote
                ? basisCaption({
                    pcs: shownPcs,
                    bandStartMilli: die.bandStartMilli,
                    copyMilli: copy?.currentMilli ?? null,
                    copyCode: copy?.code ?? null,
                    sectionCode: die.code,
                    cutLengthFt: lengthFt ?? 0,
                    weightBasis,
                    basisMilli: quote.basisMilli,
                  })
                : `${formatMilli(die.bandStartMilli)} kg/12 ft at band start · ${
                    copy ? `${formatMilli(copy.currentMilli)} at copy ${copy.code}` : "no reading yet"
                  } · using ${weightBasis === "copy_current" ? "current" : "band start"}`}
            </p>
            {quote && qtyBasis === "kg" ? (
              <div className="flex min-w-0 flex-col gap-2">
                <p className="m-0 text-[14px] leading-5">
                  {shownPcs} pcs imply {formatOrderKg(shownImplied)} kg at {formatMilli(quote.basisMilli)}. Typed{" "}
                  {formatOrderKg(quote.kgG)} kg
                  {gap === 0 ? " matches that." : ` is ${formatOrderKg(Math.abs(gap))} kg ${gap > 0 ? "above" : "under"} that.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => nudge(-1)} disabled={shownPcs <= 1}>
                    −1 piece
                  </Button>
                  <Button variant="secondary" onClick={() => nudge(1)}>
                    +1 piece
                  </Button>
                </div>
              </div>
            ) : null}
            {foreignOwner ? (
              <p className="m-0 text-[14px] leading-5">
                Copy {copy?.code} is owned by {customerName(ownerId)}. Booking can still be saved. Release onto{" "}
                {customerName(customerId)} needs a manager.
              </p>
            ) : null}
            {demo.holdPending ? (
              <Chip tone="amber">
                Pending · order reallocate · {formatKgShort(demo.holdPending.kgG)}
              </Chip>
            ) : null}
            {planRest ? (
              <p className="m-0 text-[14px] leading-5 text-muted-foreground">
                Planning will skip the kg already in the yard. This line's own kg is what would be planned.
              </p>
            ) : null}
          </div>
        </Card>

        <FormActions>
          <Button onClick={onSave}>Save</Button>
        </FormActions>
      </div>

      <StockSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        sectionCode={die.code}
        lengthFt={lengthFt}
        yard={demo.yard}
        holdError={holdError}
        onHold={onHold}
        onLeave={() => setSheetOpen(false)}
        onPlanRest={() => {
          setPlanRest(true);
          setSheetOpen(false);
        }}
      />
    </PreviewFrame>
  );
}
