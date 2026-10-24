import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardSection } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import {
  buildSpectro,
  formatDuration,
  formatInches,
  formatKgFromG,
  formatKgValue,
  formatPercentFromBp,
  FURNACE,
  K31_CHARGE,
  K31_IRON_G,
  K31_LDO,
  K31_LOG,
  K31_STORE,
  K31_TIMES,
  kgPerPiece,
  k31Balance,
  minutesBetween,
  SPECTRO_FILE,
  verdictTone,
  verdictWord,
  type ChargeLine,
  type MeltBalance,
} from "../fixtures";
import { lockK31, setBalanceReason, setDrossZeroed, useFoundryPreview } from "../store";
import { FoundryScreenNav } from "./screen-nav";
import { SpectroTable } from "./spectro-table";

export function CastScreen() {
  const preview = useFoundryPreview();
  const balance = k31Balance(preview.drossZeroed);
  const spectro = buildSpectro("6063", false);
  const reason = preview.balanceReason.trim();
  const needsReason = balance.outside3 && reason.length === 0;
  const canLock = !preview.k31Locked && !needsReason && !balance.overCapacity;
  const each = kgPerPiece(K31_LOG.kgG, K31_LOG.pcs);
  const lockedTone = preview.k31Locked ? (balance.outside3 ? "amber" : "green") : "amber";
  const lockedWord = preview.k31Locked ? "Locked" : "Draft";

  const lock = () => {
    lockK31(canLock);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FoundryScreenNav current="cast" />
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={lockedTone}>{lockedWord}</Chip>
        <Chip tone={verdictTone(spectro.verdict)}>{verdictWord(spectro.verdict)}</Chip>
        <Badge tone="neutral">
          {FURNACE.code} · {FURNACE.capacityG / 1_000_000} t · {formatInches(FURNACE.diameterMm)} inch
        </Badge>
        {balance.overCapacity ? <Chip tone="amber">Over furnace capacity</Chip> : null}
        {preview.k31Locked ? <Chip tone="green">Posted</Chip> : <Chip tone="amber">Not posted</Chip>}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="order-2 flex min-w-0 flex-col gap-5 md:order-1">
          <Card>
            <CardSection title="Times" description={`${FURNACE.name} · book date 24 Oct 2026`}>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <TimeCell label="Preheat start" value={K31_TIMES.preheatStart} />
                <TimeCell label="Charging start" value={K31_TIMES.chargingStart} large />
                <TimeCell label="Charging end" value={K31_TIMES.chargingEnd} />
                <TimeCell label="Casting start" value={K31_TIMES.castingStart} />
                <TimeCell label="Casting end" value={K31_TIMES.castingEnd} large />
              </div>
              <p className="m-0 text-[13px] text-muted-foreground">
                Charging {formatDuration(minutesBetween(K31_TIMES.chargingStart, K31_TIMES.chargingEnd))} · Casting{" "}
                {formatDuration(minutesBetween(K31_TIMES.castingStart, K31_TIMES.castingEnd))}
              </p>
            </CardSection>
          </Card>

          <Card>
            <CardSection
              title="Charge"
              description="Gross is the sum of these lines. OK kanta lots and one return stream."
            >
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {K31_CHARGE.map((line) => (
                  <ChargeRow key={line.id} line={line} />
                ))}
              </ul>
              <p className="m-0 font-mono text-[14px] font-semibold tabular-nums">
                Metal in {formatKgFromG(balance.metalInG)} kg
              </p>
            </CardSection>
          </Card>

          <Card>
            <CardSection title="Store and LDO" description="Chemicals leave the store. Inches stay inches.">
              <p className="m-0 text-[15px]">
                {K31_STORE.item} {formatKgFromG(K31_STORE.kgG)} kg ({K31_STORE.mrs})
              </p>
              <p className="m-0 text-[15px] tabular-nums">
                LDO inches {K31_LDO.startInches} → {K31_LDO.endInches}
              </p>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                Not converted to litres. A lower end reading is a refill during the cycle, not a warning. Cover flux
                is not burn loss.
              </p>
            </CardSection>
          </Card>

          <Card>
            <CardSection title="Output" description="Weighed kg. Billet length is the length the press will charge.">
              <p className="m-0 text-[15px]">
                {K31_LOG.pcs} billets · log length {K31_LOG.logLengthFt} ft · billet length {K31_LOG.billetLengthFt} ft
                · {formatInches(K31_LOG.diameterMm)} inch ·{" "}
                <span className="font-mono font-semibold tabular-nums">{formatKgFromG(K31_LOG.kgG)} kg</span>
              </p>
              {each != null ? (
                <p className="m-0 text-[13px] text-muted-foreground tabular-nums">
                  {formatKgValue(each, 1)} kg each, from {formatKgFromG(K31_LOG.kgG)} kg / {K31_LOG.pcs} pcs
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <p className="m-0 text-[15px]">
                  Dross{" "}
                  <span className="font-mono font-semibold tabular-nums">{formatKgFromG(balance.drossG)} kg</span>
                  <span className="block text-[13px] font-normal text-muted-foreground">Credits dross metal</span>
                </p>
                <p className="m-0 text-[15px]">
                  Iron{" "}
                  <span className="font-mono font-semibold tabular-nums">{formatKgFromG(K31_IRON_G)} kg</span>
                  <span className="block text-[13px] font-normal text-muted-foreground">Credits iron</span>
                </p>
              </div>
            </CardSection>
          </Card>
        </div>

        <div className="order-1 flex min-w-0 flex-col gap-5 md:sticky md:top-4 md:order-2 md:self-start">
          <BalancePanel balance={balance} />
          <Card>
            <CardSection title="Spectro" description="6063 seed limits. Aluminium is the balance.">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={verdictTone(spectro.verdict)}>{verdictWord(spectro.verdict)}</Chip>
                <Badge tone="info">{SPECTRO_FILE} · attached</Badge>
              </div>
              <SpectroTable sheet={spectro} />
            </CardSection>
          </Card>
        </div>
      </div>

      <div className="foundry-no-print flex flex-col gap-3 rounded-card border border-dashed border-border bg-surface-sunken p-4">
        <p className="m-0 text-[13px] font-medium text-muted-foreground">Demo</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            aria-pressed={preview.drossZeroed}
            disabled={preview.k31Locked}
            onClick={() => setDrossZeroed(!preview.drossZeroed)}
          >
            Show a 4.8% burn
          </Button>
          {preview.drossZeroed && !preview.k31Locked ? (
            <Button variant="secondary" onClick={() => setDrossZeroed(false)}>
              Restore 96 kg dross
            </Button>
          ) : null}
        </div>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">
          {preview.drossZeroed
            ? `Dross is 0 kg. Burn is ${formatKgFromG(balance.burnG)} kg, ${formatPercentFromBp(balance.balanceBp)} of ${formatKgFromG(balance.metalInG)} kg in.`
            : "Sets dross to 0 kg. Burn is metal in minus logs, dross and iron."}
        </p>
      </div>

      {balance.outside3 && !preview.k31Locked ? (
        <Field
          label="Balance reason"
          hint="Required when burn is outside 3%. 1–500 characters."
          error={needsReason ? "Write why burn is outside 3% before locking." : undefined}
        >
          <TextInput
            value={preview.balanceReason}
            onChangeText={setBalanceReason}
            maxLength={500}
            aria-label="Balance reason"
          />
        </Field>
      ) : null}
      {preview.k31Locked && balance.outside3 ? (
        <p className="m-0 text-[14px]">
          Balance reason: <span className="font-medium">{preview.balanceReason.trim()}</span>
        </p>
      ) : null}

      {preview.k31Locked ? (
        <p role="status" className="m-0 text-[15px] font-semibold">
          Posted {formatKgFromG(K31_LOG.kgG)} kg to the billet store.{" "}
          <Link to="/preview/foundry/stock" className="text-foreground underline underline-offset-4">
            Billet stock
          </Link>
        </p>
      ) : null}

      {balance.overCapacity && !preview.k31Locked ? (
        <p role="status" className="m-0 text-[14px] font-medium text-destructive">
          Lock melt is refused: the charge is over the furnace capacity.
        </p>
      ) : null}

      <FormActions className="max-sm:bottom-[var(--shell-tabbar-offset)] md:sticky md:bottom-4 md:z-10 md:rounded-card md:border md:border-border md:bg-card/95 md:p-2 md:shadow-md md:backdrop-blur-md">
        <Button disabled={!canLock} onClick={lock}>
          Lock melt
        </Button>
      </FormActions>
    </div>
  );
}
function BalancePanel({ balance }: { balance: MeltBalance }) {
  const burnTone = balance.outside3 ? "amber" : "green";
  return (
    <Card>
      <CardSection title="Balance" description="Computed at lock. Not a typed burn.">
        {balance.overCapacity ? (
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">
            {formatKgFromG(balance.overG)} kg over the {formatKgFromG(FURNACE.capacityG)} kg furnace (
            {formatPercentFromBp(balance.capacityPctBp)}). Lock melt is refused until the charge is at or under
            capacity.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-1 lg:grid-cols-2">
          <StatusBlock
            tone="neutral"
            title="In"
            value={balance.metalInG / 1000}
            unit="kg"
            meta="Lots and plant scrap"
            countUp={false}
          />
          <StatusBlock
            tone="neutral"
            title="Out"
            value={balance.outG / 1000}
            unit="kg"
            meta="Logs, dross and iron"
            countUp={false}
          />
          <StatusBlock
            tone={burnTone}
            title="Burn"
            value={formatPercentFromBp(balance.balanceBp)}
            meta={`${formatKgFromG(balance.burnG)} kg · ${balance.outside3 ? "outside" : "inside"} 3%`}
            countUp={false}
          />
          <StatusBlock
            tone="blue"
            title="Yield"
            value={formatPercentFromBp(balance.yieldBp)}
            meta="Log kg / metal in"
            countUp={false}
          />
        </div>
        <Chip tone={burnTone}>{balance.outside3 ? "Outside 3%" : "Inside 3%"}</Chip>
        <p className="m-0 font-mono text-[13px] leading-5 tabular-nums text-muted-foreground">
          {formatKgFromG(balance.metalInG)} − {formatKgFromG(balance.logsG)} − {formatKgFromG(balance.drossG)} −{" "}
          {formatKgFromG(balance.ironG)} = {formatKgFromG(balance.burnG)} kg
        </p>
      </CardSection>
    </Card>
  );
}

function TimeCell({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("m-0 font-mono font-semibold tabular-nums", large ? "text-[28px] leading-none" : "text-[17px]")}>
        {value}
      </p>
    </div>
  );
}

function ChargeRow({ line }: { line: ChargeLine }) {
  if (line.kind === "lot") {
    return (
      <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[15px] font-semibold">{line.lotNo}</p>
          <p className="m-0 text-[14px] break-words">
            {line.vendor}, {line.city}
          </p>
          <p className="m-0 text-[13px] text-muted-foreground">
            {line.item} · {line.grade}
          </p>
        </div>
        <p data-no-truncate="" className="m-0 font-mono text-[15px] font-semibold tabular-nums">
          {formatKgFromG(line.kgG)} kg
        </p>
      </li>
    );
  }
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="m-0 text-[15px] font-semibold">{line.stream}</p>
        <p className="m-0 text-[13px] text-muted-foreground">Return stream</p>
      </div>
      <p data-no-truncate="" className="m-0 font-mono text-[15px] font-semibold tabular-nums">
        {formatKgFromG(line.kgG)} kg
      </p>
    </li>
  );
}
