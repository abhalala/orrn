import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { cn } from "@orrn/ui/lib/utils";
import { Activity, Monitor, MonitorOff, MonitorPause, MonitorUp, Scale } from "lucide-react";
import type { ReactNode } from "react";

import { collectorRowsOf, scaleRowOf, type CollectorReport, type NodeStatus } from "./model";
import { nodeState, nodeStateTone, primaryNode, type NodeState } from "./printers-model";

type When = (d: Date | string | number) => string;

export type PrintNode = {
  id: string;
  nodeName: string;
  siteLabel: string;
  status: NodeStatus;
  runtimeVersion: string | null;
  lastHeartbeatAt: Date | string | null;
  lastErrorMessage: string | null;
  scaleConfigured?: boolean | null;
  scaleSimulated?: boolean | null;
  scaleLastFrameAt?: Date | string | null;
  scaleReportedAt?: Date | string | null;
  collectors?: CollectorReport[] | null;
  collectorsReportedAt?: Date | string | null;
};

const STATE_ICON: Record<NodeState, ReactNode> = {
  online: <Monitor aria-hidden="true" className="size-7" strokeWidth={2} />,
  offline: <MonitorOff aria-hidden="true" className="size-7" strokeWidth={2} />,
  never: <MonitorUp aria-hidden="true" className="size-7" strokeWidth={2} />,
  revoked: <MonitorPause aria-hidden="true" className="size-7" strokeWidth={2} />,
};

/**
 * The print computer, as it last reported: one status block for the computer the page leads with
 * (the screen's one loud element), what is connected to it underneath, then any other computers as quiet rows.
 */
export function PrintComputerSection({ nodes, when, nowMs }: { nodes: readonly PrintNode[]; when: When; nowMs: number }) {
  const { t } = useT();
  const lead = primaryNode(nodes);
  const others = nodes.filter((node) => node !== lead);
  return (
    <section aria-labelledby="print-computer-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="print-computer-heading" className="m-0 text-[17px] font-semibold">
        {t("printing.nodes.title")}
      </h2>
      {lead ? <LeadNode node={lead} when={when} nowMs={nowMs} /> : <p className="m-0 text-[15px] text-muted-foreground">{t("printing.nodes.none")}</p>}
      {others.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold">{t("printing.nodes.others")}</h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-card border border-border bg-card p-0">
            {others.map((node) => (
              <OtherNode key={node.id} node={node} when={when} nowMs={nowMs} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function LeadNode({ node, when, nowMs }: { node: PrintNode; when: When; nowMs: number }) {
  const { t } = useT();
  const state = nodeState(node, nowMs);
  return (
    <div data-testid="print-node" data-state={state} className="flex min-w-0 flex-col gap-3">
      <div className={cn("orrn-block flex min-w-0 flex-col gap-4 p-5 sm:p-6", `orrn-block-${nodeStateTone(state)}`)}>
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="m-0 text-[15px] font-semibold break-words">{node.nodeName}</h3>
            <p className="m-0 font-display text-[28px] leading-[1.05] font-bold tracking-[-0.025em] break-words sm:text-[34px]">{t(`printing.nodes.state.${state}`)}</p>
          </div>
          <span className="mt-1 shrink-0">{STATE_ICON[state]}</span>
        </div>
        <p className="m-0 max-w-[62ch] text-[15px] leading-6 text-pretty">{t(`printing.nodes.stateBody.${state}`)}</p>
        <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-3">
          <Fact term={t("printing.nodes.lastSeenTerm")}>
            {node.lastHeartbeatAt ? t("printing.nodes.lastSeen", { time: when(node.lastHeartbeatAt) }) : t("printing.nodes.neverSeen")}
          </Fact>
          <Fact term={t("printing.nodes.versionTerm")}>
            {node.runtimeVersion ? <span className="font-mono tabular-nums">{node.runtimeVersion}</span> : t("printing.nodes.notReported")}
          </Fact>
          <Fact term={t("printing.nodes.siteTerm")}>{node.siteLabel}</Fact>
        </dl>
        {node.lastErrorMessage ? (
          <p className="m-0 text-[14px] leading-5 break-words">{t("printing.nodes.lastError", { message: node.lastErrorMessage })}</p>
        ) : null}
      </div>
      <Attached node={node} when={when} />
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[13px] font-medium">{term}</dt>
      <dd className="m-0 font-semibold break-words">{children}</dd>
    </div>
  );
}

/** Scale and collectors on the lead computer: quiet rows under the block, as last reported. */
function Attached({ node, when }: { node: PrintNode; when: When }) {
  const { t } = useT();
  const collectors = collectorRowsOf(node);
  return (
    <div className="flex min-w-0 flex-col divide-y divide-border rounded-card border border-border bg-card">
      <ScaleRow node={node} when={when} />
      {collectors.kind === "unknown" ? null : (
        <div data-slot="collectors-row" className="flex min-w-0 flex-col gap-3 p-4">
          <p className="m-0 flex items-center gap-2 text-[14px] font-semibold">
            <Activity aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={2} />
            {t("printing.collectors.title")}
          </p>
          {collectors.kind === "none" ? <p className="m-0 text-[13px] text-muted-foreground">{t("printing.collectors.none")}</p> : null}
          {collectors.kind === "list"
            ? collectors.items.map((item) => (
                <div key={item.key} data-collector={item.kind} data-state={item.state} className="flex min-w-0 flex-col gap-1">
                  <p className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-[14px]">
                    <span className="font-medium">
                      {item.kind === "press" ? t("printing.collectors.press", { line: item.line ?? "?" }) : t("printing.collectors.spectro")}
                    </span>
                    {item.state === "sending" ? <Chip tone="green">{t("printing.collectors.sending")}</Chip> : null}
                    {item.state === "watching" ? <Chip tone="green">{t("printing.collectors.watching")}</Chip> : null}
                    {item.state === "quiet" ? <Chip tone="amber">{t("printing.collectors.quiet")}</Chip> : null}
                    {item.state === "not_configured" ? <Chip tone="neutral">{t("printing.collectors.notConfigured")}</Chip> : null}
                    {item.simulated ? <Chip tone="blue">{t("printing.collectors.simulated")}</Chip> : null}
                  </p>
                  <p className="m-0 text-[13px] leading-5 break-words text-muted-foreground">
                    {item.lastFrameAt
                      ? t("printing.collectors.lastFrame", { time: when(item.lastFrameAt) })
                      : t("printing.collectors.noFrame", { time: when(collectors.reportedAt) })}
                    {item.backlog > 0 ? `. ${t("printing.collectors.backlog", { count: item.backlog })}` : ""}
                  </p>
                  {item.simulated ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("printing.collectors.simulatedHint")}</p> : null}
                  {item.lastError ? (
                    <p className="m-0 text-[13px] leading-5 break-words text-muted-foreground">{t("printing.collectors.error", { message: item.lastError })}</p>
                  ) : null}
                </div>
              ))
            : null}
        </div>
      )}
    </div>
  );
}

/** The scale beside the printer (FP-PK-02): configured, simulated, connected, and when its last frame came. */
function ScaleRow({ node, when }: { node: PrintNode; when: When }) {
  const { t } = useT();
  const row = scaleRowOf({
    scaleConfigured: node.scaleConfigured ?? null,
    scaleSimulated: node.scaleSimulated ?? null,
    scaleLastFrameAt: node.scaleLastFrameAt ?? null,
    scaleReportedAt: node.scaleReportedAt ?? null,
  });
  return (
    <div data-slot="scale-row" data-scale={row.kind} className="flex min-w-0 flex-col gap-1 p-4">
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-semibold">
        <Scale aria-hidden="true" className="size-4 text-muted-foreground" strokeWidth={2} />
        {t("printing.scale.title")}
        {row.kind === "connected" ? <Chip tone="green">{t("printing.scale.connected")}</Chip> : null}
        {row.kind === "idle" ? <Chip tone="amber">{t("printing.scale.idle")}</Chip> : null}
        {row.kind === "none" ? <Chip tone="neutral">{t("printing.scale.none")}</Chip> : null}
        {row.kind === "unknown" ? <Chip tone="neutral">{t("printing.scale.unknown")}</Chip> : null}
        {(row.kind === "connected" || row.kind === "idle") && row.simulated ? <Chip tone="blue">{t("printing.scale.simulated")}</Chip> : null}
      </p>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">
        {row.kind === "connected"
          ? t("printing.scale.lastFrame", { time: when(row.lastFrameAt) })
          : row.kind === "idle"
            ? t("printing.scale.noFrame", { time: when(row.reportedAt) })
            : row.kind === "none"
              ? t("printing.scale.noneHint")
              : t("printing.scale.unknownHint")}
      </p>
    </div>
  );
}

function OtherNode({ node, when, nowMs }: { node: PrintNode; when: When; nowMs: number }) {
  const { t } = useT();
  const state = nodeState(node, nowMs);
  return (
    <li data-testid="print-node" data-state={state} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold break-words">{node.nodeName}</span>
        <span className="text-[13px] text-muted-foreground break-words">
          {node.lastHeartbeatAt ? t("printing.nodes.lastSeen", { time: when(node.lastHeartbeatAt) }) : t("printing.nodes.neverSeen")}
          {node.runtimeVersion ? `. ${t("printing.nodes.version", { version: node.runtimeVersion })}` : ""}
        </span>
      </div>
      <Chip tone={nodeStateTone(state)}>{t(`printing.nodes.state.${state}`)}</Chip>
    </li>
  );
}
