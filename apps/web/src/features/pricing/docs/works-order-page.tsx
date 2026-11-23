import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { Can } from "@/shared/components/can";
import { usePaperFmt } from "@/shared/lib/fmt";
import { paperT } from "@/shared/lib/fmt-text";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { buildWorksOrderPaper, type PaperDoc } from "./docs-model";

/**
 * `/orders/$id/works-order`: what to make for this order, for the press, the die room and dispatch. No prices anywhere:
 * the server's answer carries none and the paper has no price column. A paper: today's units and words whatever the
 * plant chose for its screens (`paper-guard.test.ts` lists this file). The number (WO-n) is taken once per order.
 */
export function WorksOrderPage({ orderId }: { orderId: string }) {
  const { t: tUi } = useT();
  const t = useMemo(() => paperT(tUi), [tUi]);
  const fmt = usePaperFmt();
  const get = useQuery(trpc.pricing.worksOrder.get.queryOptions({ orderId }));
  const [printing, setPrinting] = useState(false);

  const issue = useMutation({
    mutationFn: () => trpcClient.pricing.worksOrder.issue.mutate({ orderId }),
  });

  const back = { to: `/orders/${orderId}`, label: tUi("price.worksOrder.backToOrder") };
  if (get.isPending) {
    return (
      <>
        <PageHeader title={tUi("price.worksOrder.title")} back={back} />
        <Skeleton className="h-40 w-full" />
      </>
    );
  }
  if (get.isError || !get.data) {
    return (
      <>
        <PageHeader title={tUi("price.worksOrder.title")} back={back} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState title={tUi("price.worksOrder.loadFailed")} action={<Button onClick={() => void get.refetch()}>{tUi("common.retry")}</Button>} />
        </div>
      </>
    );
  }
  const data = get.data;
  const number = data.worksOrder?.number ?? null;
  const open = data.order.status === "confirmed" || data.order.status === "dispatching";
  const paper = buildWorksOrderPaper(data, number, fmt, t);

  const print = async (withNumber: string | null) => {
    setPrinting(true);
    try {
      const doc = withNumber === number ? paper : buildWorksOrderPaper(data, withNumber, fmt, t);
      const { buildPaperHtml, printPaperHtml } = await import("./paper-html");
      printPaperHtml(buildPaperHtml(doc));
    } catch {
      toast.error(tUi("price.worksOrder.printFailed"));
    } finally {
      setPrinting(false);
    }
  };

  const issueAndPrint = async () => {
    setPrinting(true);
    try {
      const res = await issue.mutateAsync();
      await get.refetch();
      await print(res.number);
    } catch (e) {
      toast.error(serverRefusal(tUi, e));
      setPrinting(false);
    }
  };

  const plain = (
    <Button variant="secondary" loading={printing} onClick={() => void print(number)} data-works-order-print="">
      <Printer aria-hidden="true" strokeWidth={2} />
      {tUi("price.worksOrder.print")}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={number ? `${tUi("price.worksOrder.title")} ${number}` : tUi("price.worksOrder.title")}
        subtitle={[data.order.number, data.order.customerName].join(" · ")}
        back={back}
        actions={
          number || !open ? (
            plain
          ) : (
            <Can do={["order.manage", "order.plan"]} fallback={plain}>
              <Button size="lg" loading={printing} onClick={() => void issueAndPrint()} data-works-order-issue="">
                <Printer aria-hidden="true" strokeWidth={2} />
                {tUi("price.worksOrder.issueAndPrint")}
              </Button>
            </Can>
          )
        }
      />
      {!number ? <p className="m-0 text-[14px] leading-5 text-muted-foreground">{tUi(open ? "price.worksOrder.notIssuedHint" : "price.worksOrder.notConfirmed")}</p> : null}
      <PaperTable doc={paper} />
    </>
  );
}

function PaperTable({ doc }: { doc: PaperDoc }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-works-order="">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
        {doc.meta.map(([k, v]) => (
          <div key={k} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="m-0 font-semibold">{v}</dd>
          </div>
        ))}
        {doc.party ? (
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">{doc.party.label}</dt>
            <dd className="m-0 font-semibold">{doc.party.name}</dd>
          </div>
        ) : null}
      </dl>
      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {doc.columns.map((c, i) => (
                <th key={c} scope="col" className={`border-b border-border px-3 py-2 text-[13px] font-semibold ${doc.align[i] === "r" ? "text-right" : "text-left"}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, i) => (
                  <td key={i} className={`border-b border-border px-3 py-2 align-top ${doc.align[i] === "r" ? "text-right font-mono tabular-nums" : ""}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {doc.notes.map((n) => (
        <p key={n} className="m-0 text-[14px] leading-5">
          {n}
        </p>
      ))}
    </div>
  );
}
