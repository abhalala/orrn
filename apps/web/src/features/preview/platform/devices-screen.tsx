import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { DataTable } from "@orrn/ui/components/data-table";
import { Dialog } from "@orrn/ui/components/dialog";
import { ListCard } from "@orrn/ui/components/list-card";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useState } from "react";

import { ChromeStrip, LanguageToggle, PlatformLinks } from "./chrome";
import {
  APP_ID,
  belowMinimum,
  formatSeen,
  INSTALLS,
  LATEST_BUILD,
  LATEST_VERSION,
  MIN_BUILD,
  RELEASE_NOTES,
  SAVED_SHIFTS,
  seenThisProductionDay,
  shift1,
  type Install,
} from "./fixtures";

type GateSubject = "phone" | "tablet";

export function DevicesScreen() {
  const [revoked, setRevoked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [gate, setGate] = useState<GateSubject>("phone");
  const start = shift1(SAVED_SHIFTS)?.startMin ?? 8 * 60;
  const tablet = INSTALLS.find((install) => install.kind === "tablet");
  const phone = INSTALLS.find((install) => install.kind === "phone");

  if (!tablet || !phone) return null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PlatformLinks current="devices" />
      <p className="m-0 text-[15px] leading-6 text-muted-foreground">
        {APP_ID} · latest {LATEST_VERSION} build {LATEST_BUILD} · minimum {MIN_BUILD}. A build below the minimum cannot open the floor.
      </p>
      <DataTable
        columns={[
          { id: "install", header: "Install", cell: (row) => row.label },
          { id: "build", header: "Build", cell: (row) => row.build, sortValue: (row) => row.build },
          { id: "seen", header: "Last seen", cell: (row) => formatSeen(row) },
        ]}
        rows={[...INSTALLS]}
        rowKey={(row) => row.id}
        renderCard={(row) => (
          <InstallCard
            install={row}
            revoked={revoked && row.kind === "tablet"}
            thisDay={seenThisProductionDay(row, start)}
            onRevoke={row.kind === "tablet" && !revoked ? () => setConfirmOpen(true) : undefined}
          />
        )}
      />
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Revoke this tablet?"
        description={`Last seen ${formatSeen(tablet)}. Revoke keeps the row and blocks the install.`}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setRevoked(true);
                setConfirmOpen(false);
                setGate("tablet");
              }}
            >
              Revoke
            </Button>
          </>
        }
      />
      <SegmentedControl
        label="Gate preview"
        value={gate}
        onChange={setGate}
        options={[
          { value: "phone", label: "Phone" },
          { value: "tablet", label: "Tablet" },
        ]}
      />
      {gate === "phone" ? <BlockedGate title={`Build ${phone.build} is below the minimum, ${MIN_BUILD}`} detail={RELEASE_NOTES} /> : null}
      {gate === "tablet" && revoked ? (
        <BlockedGate title="This tablet was revoked" detail={`Last seen ${formatSeen(tablet)}. The floor does not open.`} />
      ) : null}
      {gate === "tablet" && !revoked ? (
        <section className="flex min-h-[70vh] flex-col gap-4 rounded-card border border-border bg-card p-5" aria-label="Current install">
          <p className="m-0 font-mono text-[13px]">{APP_ID}</p>
          <h2 className="m-0 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em]">
            Build {tablet.build} is current
          </h2>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">
            Minimum is {MIN_BUILD}. This install is not blocked. Revoke it to see the same kind of block as the phone.
          </p>
          <ChromeStrip />
        </section>
      ) : null}
    </div>
  );
}

function InstallCard({
  install,
  revoked,
  thisDay,
  onRevoke,
}: {
  install: Install;
  revoked: boolean;
  thisDay: boolean;
  onRevoke?: () => void;
}) {
  const blocked = belowMinimum(install.build) || revoked;
  const status = revoked ? "Revoked" : belowMinimum(install.build) ? "Blocked" : "Current";
  return (
    <ListCard
      title={install.label}
      titleText={install.label}
      subtitle={`${install.person} · packer`}
      status={<Chip tone={blocked ? "red" : "green"}>{status}</Chip>}
      facts={[
        { label: "App", value: APP_ID, mono: true, truncate: true, title: APP_ID },
        { label: "Build", value: `${install.version} · ${install.build}`, mono: true },
        { label: "Last seen", value: formatSeen(install), mono: true },
        { label: "Seen", value: thisDay ? "This production day" : "Earlier" },
      ]}
      footer={
        onRevoke ? (
          <Button type="button" variant="danger" onClick={onRevoke}>
            Revoke
          </Button>
        ) : undefined
      }
    />
  );
}

function BlockedGate({ title, detail }: { title: string; detail: string }) {
  return (
    <section
      className="flex min-h-[70vh] flex-col justify-between gap-5 rounded-card border border-border bg-card p-5"
      aria-label="Update gate"
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 font-mono text-[13px]">{APP_ID}</p>
        <h2 className="m-0 font-display text-[32px] font-extrabold leading-[1.05] tracking-[-0.035em]">{title}</h2>
        <p className="m-0 text-[15px] leading-6">{detail}</p>
        <LanguageToggle />
        <ChromeStrip />
      </div>
      <p className="m-0 text-[13px] font-medium text-muted-foreground">No dismiss. The floor stays closed.</p>
    </section>
  );
}
