/**
 * Dev-only kitchen sink for the C2 component library (`@orrn/ui`), mounted at
 * /__ui by `routes/[__ui].tsx`. Every component in every state, for building
 * screens and for the Playwright suite in tests/e2e/ui-kit.spec.ts. The route
 * only imports this file in dev builds, so production never ships it.
 *
 * The demo copy below is hard-coded English on purpose: this page never ships,
 * so it doesn't belong in the en/hi message catalogue. The components' own
 * chrome (Close, Next page, Step 1 of 3, How to) comes from @orrn/i18n.
 */
import { formatKgTotal, parseDecimal, type StatusTone } from "@orrn/domain";
import { I18nProvider, type Locale } from "@orrn/i18n";
import { ActionTile } from "@orrn/ui/components/action-tile";
import { BigNumber } from "@orrn/ui/components/big-number";
import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { motionClass, riseDelay } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { ScanField } from "@orrn/ui/components/scan-field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { Stepper } from "@orrn/ui/components/stepper";
import { Tabs } from "@orrn/ui/components/tabs";
import { cn } from "@orrn/ui/lib/utils";
import { BookOpen, Boxes, CircleCheck, MoreHorizontal, Package, Printer, ScanLine, Truck } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */
/* Demo data                                                                  */
/* -------------------------------------------------------------------------- */

type DemoBundle = {
  serial: string;
  section: string;
  kg: number;
  pcs: number;
  status: { tone: StatusTone; label: string };
};

const SECTIONS = ['Patti 1" x 1/8"', 'Angle 1" x 1"', 'Tee 1 1/4"', 'Channel 3/4" x 1/2"'];
const STATUSES: DemoBundle["status"][] = [
  { tone: "green", label: "In stock" },
  { tone: "green", label: "In stock" },
  { tone: "blue", label: "Held" },
  { tone: "neutral", label: "Dispatched" },
  { tone: "red", label: "Void" },
];

/** Row 2 carries a deliberately long section name to exercise wrapping. */
const LONG_SECTION = 'Channel 3/4" x 1/2" heavy wall, anodised silver, for KD Extrusion Private Limited';

const BUNDLES: DemoBundle[] = Array.from({ length: 12 }, (_, i) => ({
  serial: `BG-000318-B${String(i + 1).padStart(3, "0")}`,
  section: i === 1 ? LONG_SECTION : SECTIONS[i % SECTIONS.length]!,
  kg: 48.2 + ((i * 37) % 60) / 10,
  pcs: 20 + (i % 4),
  status: STATUSES[i % STATUSES.length]!,
}));

const DIES: ComboboxOption<string>[] = [
  { value: "14701", label: 'Patti 1" x 1/8"', hint: "Die 14701 · 2.4 to 2.6 kg/12ft" },
  { value: "11250", label: 'Angle 1" x 1"', hint: "Die 11250 · 2.1 to 2.3 kg/12ft" },
  { value: "11251", label: 'Angle 1" x 1/2"', hint: "Die 11251 · 1.4 to 1.6 kg/12ft" },
  { value: "13090", label: 'Tee 1 1/4"', hint: "Die 13090 · 3.0 to 3.2 kg/12ft" },
  { value: "15520", label: 'Channel 3/4" x 1/2"', hint: "Die 15520 · 1.8 to 2.0 kg/12ft" },
];

/** Pretend server search: 250ms latency, case-insensitive match on label or code. */
function searchDies(q: string): Promise<ComboboxOption<string>[]> {
  const needle = q.toLowerCase();
  return new Promise((resolve) =>
    setTimeout(
      () => resolve(DIES.filter((d) => d.label.toLowerCase().includes(needle) || d.value.includes(needle))),
      250,
    ),
  );
}

const COLUMNS: ResponsiveListColumn<DemoBundle>[] = [
  { key: "serial", header: "Serial", cell: (b) => <span className="font-mono whitespace-nowrap">{b.serial}</span> },
  { key: "section", header: "Section", cell: (b) => b.section },
  { key: "kg", header: "Weight (kg)", align: "end", cell: (b) => <span className="font-mono">{b.kg.toFixed(2)}</span> },
  { key: "pcs", header: "Pieces", align: "end", hideOnPhone: true, cell: (b) => <span className="font-mono">{b.pcs}</span> },
  { key: "status", header: "Status", cell: (b) => <Chip tone={b.status.tone}>{b.status.label}</Chip> },
  {
    key: "print",
    header: "Label",
    align: "end",
    // A real control inside a linked row: it sits above the row link.
    cell: (b) => (
      <IconButton
        label={`Print label ${b.serial}`}
        variant="secondary"
        icon={<Printer />}
        onClick={() => toast.success(`Label sent to printer: ${b.serial}`)}
      />
    ),
  },
];

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function KitPage() {
  const [locale, setLocale] = useState<Locale>("en");

  // The kit can switch language on its own; keep <html lang> honest while it does.
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [locale]);

  return (
    <I18nProvider locale={locale} onLocaleChange={setLocale}>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[1100px] flex-col gap-12 px-4 pt-6 pb-24 md:px-6 md:pt-10">
        <PageHeader
          title="Component kit"
          subtitle="Every C2 component, in every state. Dev only."
          back={{ to: "/", label: "Home" }}
          actions={
            <>
              <HowToButton slug="pack-session" />
              <Button onClick={() => toast.success("Packing session started")}>New packing session</Button>
            </>
          }
        />
        <KitControls locale={locale} onLocale={setLocale} />
        <BlocksSection />
        <TilesSection />
        <ButtonsSection />
        <FieldsSection />
        <ChoosingSection />
        <ScanSection />
        <ListSection />
        <OverlaysSection />
        <FeedbackSection />
        <LongTextSection />
      </main>
    </I18nProvider>
  );
}

function KitSection({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`kit-${id}`} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id={`kit-${id}`} className="m-0 font-display text-[22px] font-bold tracking-[-0.025em]">
          {title}
        </h2>
        {note ? <p className="m-0 max-w-[640px] text-[14px] leading-6 text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)}>{children}</div>;
}

function KitControls({ locale, onLocale }: { locale: Locale; onLocale(l: Locale): void }) {
  const { theme = "system", setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[13px] font-semibold">
          Theme
        </span>
        <SegmentedControl
          label="Theme"
          value={theme as "system" | "light" | "dark"}
          onChange={setTheme}
          options={[
            { value: "system", label: "Match device" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[13px] font-semibold">Language</span>
        <SegmentedControl
          label="Language"
          value={locale}
          onChange={onLocale}
          options={[
            { value: "en", label: "English" },
            { value: "hi", label: "हिंदी" },
          ]}
        />
      </div>
    </div>
  );
}

function BlocksSection() {
  return (
    <KitSection
      id="blocks"
      title="Status blocks"
      note="Status is the colour, and the status word is always written too. Numbers count up once on first load."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatusBlock
          className={motionClass.rise}
          style={riseDelay(0)}
          tone="green"
          title={'Patti 1" x 1/8"'}
          meta="Die 14701 · In stock"
          value={38}
          unit="bundles, 1,912 kg"
          progress={0.78}
          href="/__ui"
        />
        <StatusBlock
          className={motionClass.rise}
          style={riseDelay(1)}
          tone="blue"
          title={'Angle 1" x 1"'}
          meta="Die 11250 · Held"
          value={22}
          unit="6 held for KD Extrusion"
          progress={0.27}
          onClick={() => toast("Opened Angle 1\" x 1\"")}
        />
        <StatusBlock
          className={motionClass.rise}
          style={riseDelay(2)}
          tone="amber"
          title={'Tee 1 1/4"'}
          meta="Die 13090 · Ageing"
          value={9}
          unit="34 days in stock"
          progress={0.55}
        />
        <StatusBlock tone="red" title="Void this month" meta="Check before the stock count" value={3} unit="bundles" />
        <StatusBlock
          tone="neutral"
          title="Dispatched today"
          meta="2 trucks"
          value={1902.6}
          format={formatKgTotal}
          unit="kg"
        />
        <StatusBlock tone="green" title="Text value" meta="Ready" value="26I4086" countUp={false} />
      </div>
    </KitSection>
  );
}

function TilesSection() {
  return (
    <KitSection id="tiles" title="Action tiles" note="Primary navigation on Today. Ink for Scan, quiet white for secondary places.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <ActionTile tone="ink" title="Scan" hint="Check a bundle label" icon={<ScanLine />} to="/__ui" />
        <ActionTile tone="green" title="Pack" hint="New packing session" icon={<Package />} to="/__ui" />
        <ActionTile tone="blue" title="Stock" hint="412 bundles ready" icon={<Boxes />} to="/__ui" />
        <ActionTile tone="red" title="Dispatch" hint="2 open" icon={<Truck />} to="/__ui" />
        <ActionTile tone="neutral" title="Guides" hint="Step by step help" icon={<BookOpen />} to="/__ui" />
      </div>
    </KitSection>
  );
}

function ButtonsSection() {
  const [busy, setBusy] = useState(false);
  return (
    <KitSection id="buttons" title="Buttons, chips and numbers" note="Pills. md is 44px, lg is 56px for primary actions on touch layouts.">
      <div className="flex flex-col gap-4">
        <Row>
          <Button>Save session</Button>
          <Button variant="secondary">Reprint label</Button>
          <Button variant="danger">Void bundle</Button>
          <Button variant="ghost">Cancel</Button>
        </Row>
        <Row>
          <Button size="lg">Add to dispatch</Button>
          <Button size="lg" variant="secondary">
            Hold stock
          </Button>
        </Row>
        <Row>
          <Button
            loading={busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => setBusy(false), 1500);
            }}
          >
            {busy ? "Saving" : "Save with loading"}
          </Button>
          <Button disabled>Dispatch</Button>
          <IconButton label="More actions" icon={<MoreHorizontal />} />
          <IconButton label="Print labels" variant="secondary" icon={<Printer />} />
        </Row>
        <Row className="gap-2">
          <Chip tone="green">In stock</Chip>
          <Chip tone="blue">Held</Chip>
          <Chip tone="amber">Draft</Chip>
          <Chip tone="red">Void</Chip>
          <Chip tone="neutral">Dispatched</Chip>
        </Row>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <p className="m-0 flex items-baseline gap-2">
            <BigNumber value={412} countUp className="text-[52px]" />
            <span className="text-[14px] text-muted-foreground">bundles in stock</span>
          </p>
          <p className="m-0 flex items-baseline gap-2">
            <BigNumber value={18940.5} format={formatKgTotal} countUp className="text-[44px]" />
            <span className="text-[14px] text-muted-foreground">kg ready</span>
          </p>
        </div>
      </div>
    </KitSection>
  );
}

function FieldsSection() {
  const [name, setName] = useState("KD Extrusion");
  const [weight, setWeight] = useState("52.40");
  const [pieces, setPieces] = useState("21");
  const [cut, setCut] = useState("0");
  const [die, setDie] = useState<string | null>(null);
  const [unit, setUnit] = useState("mm");
  const parsed = parseDecimal(weight);
  return (
    <KitSection id="fields" title="Fields" note="Label above, hint and error below. Number fields keep exactly what was typed.">
      <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
        <Field label="Customer name">
          <TextInput value={name} onChangeText={setName} autoComplete="organization" />
        </Field>
        <Field label="Die" hint="Search by die code or section. Recent dies come first.">
          <Combobox
            value={die}
            onChange={setDie}
            search={searchDies}
            placeholder="Search dies"
            recent={DIES.slice(0, 2)}
          />
        </Field>
        <Field
          label="Weight (kg)"
          hint={parsed === null ? "Type it as it shows on the scale." : `Reads as ${parsed} kg.`}
        >
          <NumberInput value={weight} onValueChange={setWeight} suffix="kg" />
        </Field>
        <Field label="Pieces">
          <NumberInput value={pieces} onValueChange={setPieces} decimal={false} />
        </Field>
        <Field label="Cut length (ft)" error="Enter a number above 0.">
          <NumberInput value={cut} onValueChange={setCut} suffix="ft" />
        </Field>
        <Field label="Length unit">
          <Select
            value={unit}
            onValueChange={setUnit}
            options={[
              { value: "mm", label: "Millimetres" },
              { value: "inch", label: "Feet and inches" },
            ]}
          />
        </Field>
      </div>
    </KitSection>
  );
}

function ChoosingSection() {
  const [show, setShow] = useState<"available" | "held" | "void">("available");
  const [tab, setTab] = useState("company");
  return (
    <KitSection id="choosing" title="Segmented control, tabs and stepper">
      <div className="flex flex-col gap-8">
        <SegmentedControl
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: "available", label: "In stock" },
            { value: "held", label: "Held" },
            { value: "void", label: "Void" },
          ]}
        />
        <Tabs
          label="Settings sections"
          value={tab}
          onValueChange={setTab}
          items={[
            { id: "company", label: "Company" },
            { id: "team", label: "Team" },
            { id: "data", label: "Data" },
          ]}
        >
          <p className="m-0 text-[15px] text-muted-foreground">
            {tab === "company" && "Company name, GSTIN and the length unit your plant measures in."}
            {tab === "team" && "Invite people and choose what each role can do."}
            {tab === "data" && "Import dies, customers and bundles from a sheet."}
          </p>
        </Tabs>
        <div className="flex flex-col gap-5">
          <Stepper steps={["Build", "Hold", "Dispatch"]} current={1} />
          <Stepper steps={["Die", "Bundles", "Review"]} current={0} />
        </div>
      </div>
    </KitSection>
  );
}

function ScanSection() {
  const [last, setLast] = useState<string | null>(null);
  const [pops, setPops] = useState(0);
  return (
    <KitSection
      id="scan"
      title="Scan and success"
      note="Enter submits, so a wedge scanner works without a click. The field clears for the next scan."
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-3">
          <ScanField
            label="Serial or label link"
            placeholder="Scan or type a serial"
            onScan={(raw) => {
              setLast(raw);
              setPops((n) => n + 1);
            }}
          />
          <p data-testid="kit-scan-result" aria-live="polite" className="m-0 min-h-6 text-[14px] text-muted-foreground">
            {last ? `Scanned ${last}` : ""}
          </p>
          <Button variant="secondary" className="self-start" onClick={() => setPops((n) => n + 1)}>
            Play success
          </Button>
        </div>
        {pops > 0 ? (
          <div
            key={pops}
            className={cn(
              "orrn-block orrn-block-hero orrn-block-green relative p-5",
              motionClass.pop,
              motionClass.shimmer,
            )}
          >
            <span className="relative inline-flex items-center gap-1.5 rounded-full bg-black/15 px-2.5 py-1 text-[13px] font-semibold">
              <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
              Scanned, in stock
            </span>
            <p className="relative m-0 mt-3 font-display text-[42px] font-extrabold leading-none tracking-[-0.04em]">
              <span className="font-mono tracking-[-0.02em]">{last ?? "26I4086"}</span>
            </p>
            <p className="relative m-0 mt-1.5 text-[14px] font-medium">Patti 1" x 1/8" · Die 14701</p>
          </div>
        ) : (
          <div className="flex min-h-[148px] items-center justify-center rounded-hero border border-dashed border-control/60 px-5 text-center text-[14px] text-muted-foreground">
            The success block pops here after a scan.
          </div>
        )}
      </div>
    </KitSection>
  );
}

function ListSection() {
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<"rows" | "loading" | "empty">("rows");
  const limit = 5;
  const rows = mode === "rows" ? BUNDLES.slice(offset, offset + limit) : [];
  return (
    <KitSection
      id="list"
      title="Responsive list"
      note="A table with real column headers from 1024px, stacked rows below. Paged on the server, always with the total."
    >
      <SegmentedControl
        label="List state"
        value={mode}
        onChange={setMode}
        options={[
          { value: "rows", label: "Rows" },
          { value: "loading", label: "Loading" },
          { value: "empty", label: "Empty" },
        ]}
      />
      <div data-testid="kit-list">
        <ResponsiveList
          label="Bundles"
          rows={rows}
          columns={COLUMNS}
          rowKey={(b) => b.serial}
          rowHref={(b) => `/b/${b.serial}`}
          total={mode === "rows" ? BUNDLES.length : 0}
          page={{ offset, limit, onChange: setOffset }}
          loading={mode === "loading"}
          empty={
            <EmptyState
              title="No bundles yet"
              body="Pack a session and its bundles show up here."
              action={<Button onClick={() => setMode("rows")}>New packing session</Button>}
            />
          }
        />
      </div>
    </KitSection>
  );
}

function OverlaysSection() {
  const [sheet, setSheet] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickedDie, setPickedDie] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  return (
    <KitSection
      id="overlays"
      title="Sheet and dialog"
      note="Sheets hold detail and short tasks: from the bottom on phones, from the right on laptops. Dialogs are for confirmations only."
    >
      <Row>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open sheet
        </Button>
        <Button variant="secondary" onClick={() => setPicker(true)}>
          Open sheet with picker
        </Button>
        <Button variant="secondary" onClick={() => setDialog(true)}>
          Open dialog
        </Button>
      </Row>
      <Sheet
        open={picker}
        onOpenChange={setPicker}
        title="Change die"
        footer={
          <Button size="lg" disabled={!pickedDie} onClick={() => setPicker(false)}>
            Use this die
          </Button>
        }
      >
        <Field label="Die" hint="Escape closes the list first, then the sheet.">
          <Combobox
            value={pickedDie}
            onChange={setPickedDie}
            search={searchDies}
            placeholder="Search dies"
            recent={DIES.slice(0, 2)}
          />
        </Field>
      </Sheet>
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Bundle 26I4086"
        description={'Patti 1" x 1/8" · Die 14701'}
        footer={
          <>
            <Button size="lg" variant="secondary" onClick={() => setSheet(false)}>
              Reprint label
            </Button>
            <Button
              size="lg"
              onClick={() => {
                setSheet(false);
                toast.success("Added to dispatch");
              }}
            >
              Add to dispatch
            </Button>
          </>
        }
      >
        <dl className="m-0 grid grid-cols-3 gap-2">
          {[
            ["Weight", "52.40"],
            ["Pieces", "21"],
            ["Cut length", "12 ft"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-card bg-surface-sunken px-3 py-2.5">
              <dt className="text-[12px] font-medium text-muted-foreground">{k}</dt>
              <dd className="m-0 font-mono text-[17px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-col divide-y divide-border rounded-card border border-border">
          {[
            ["kg/12ft", "2.52"],
            ["Weight range /12'", "2.5"],
            ["Cast", "I31"],
            ["Status", null],
          ].map(([k, v]) => (
            <div key={k} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
              <span className="text-muted-foreground">{k}</span>
              {v ? <span className="font-mono font-semibold">{v}</span> : <Chip tone="green">In stock</Chip>}
            </div>
          ))}
        </div>
      </Sheet>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Void this bundle?"
        description="It leaves stock and can't be added to a dispatch. You can restore it later."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Keep bundle
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialog(false);
                toast.success("Bundle voided");
              }}
            >
              Void bundle
            </Button>
          </>
        }
      />
    </KitSection>
  );
}

function FeedbackSection() {
  return (
    <KitSection
      id="feedback"
      title="Toasts, loading and empty"
      note="Toasts reuse the button's verb and never take focus. Skeletons take the shape of what is loading."
    >
      <Row>
        <Button variant="secondary" onClick={() => toast.success("Saved")}>
          Show saved toast
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.error("The label didn't print: the printer is offline. Check its cable and try again.")}
        >
          Show error toast
        </Button>
      </Row>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div aria-busy="true" className="flex flex-col gap-3 rounded-block bg-card p-[18px] shadow-sm">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-6 h-12 w-24" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title="No open dispatches"
            body="Start one when a truck is booked."
            action={<Button>New dispatch</Button>}
          />
        </div>
      </div>
    </KitSection>
  );
}

function LongTextSection() {
  return (
    <KitSection
      id="long-text"
      title="Long text"
      note="Real names run long. Text wraps at word boundaries or truncates with the full value on hover; only codes in mono may break anywhere."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatusBlock
          tone="blue"
          title={LONG_SECTION}
          meta="Held for KD Extrusion Private Limited, Rajkot"
          value="DSP-000214-KDEXTRUSIONPVTLTD"
          unit="dispatch code"
          countUp={false}
        />
        <ActionTile
          tone="neutral"
          title="Customers and their delivery addresses"
          hint="Add, edit and import customers from a sheet, with GSTIN and every delivery address"
          icon={<BookOpen />}
          to="/__ui"
        />
        <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title="KD Extrusion Private Limited, Rajkot">
              KD Extrusion Private Limited, Rajkot
            </span>
            <Chip tone="amber">Draft</Chip>
          </div>
          <p className="m-0 rounded-input bg-surface-sunken px-3 py-2 font-mono text-[13px] break-all">
            accounts.dispatch-desk@kd-extrusion-private-limited.co.in
          </p>
        </div>
      </div>
    </KitSection>
  );
}
