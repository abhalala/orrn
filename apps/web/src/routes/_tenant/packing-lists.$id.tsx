import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Fact, FactList } from "@orrn/ui/components/fact-list";
import { ListCard } from "@orrn/ui/components/list-card";
import { Truncate } from "@orrn/ui/components/truncate";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { requireCompanyMe } from "@/shared/lib/guards";
import { downloadPackingListPdf, type PLSnapshot } from "@/shared/lib/packingListPdf";
import { downloadPackingListXlsx } from "@/shared/lib/packingListXlsx";

export const Route = createFileRoute("/_tenant/packing-lists/$id")({
  component: PackingListDetailComponent,
  beforeLoad: requireCompanyMe,
});

type SnapshotItem = PLSnapshot["items"][number];

function PackingListDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pdfPending, setPdfPending] = useState(false);
  const [qrPdfPending, setQrPdfPending] = useState(false);
  const [xlsxPending, setXlsxPending] = useState(false);
  const lu = useLengthUnit();

  const { data: pl, isLoading } = useQuery({
    ...trpc.packingList.get.queryOptions({ id }),
  });

  const regenMutation = useMutation({
    ...trpc.packingList.regenerate.mutationOptions(),
    onSuccess: (newPl: any) => {
      toast.success("Packing list regenerated");
      queryClient.invalidateQueries({ queryKey: trpc.packingList.get.queryKey({ id }) });
      if (newPl.id !== id) {
        navigate({ to: "/packing-lists/$id", params: { id: newPl.id } });
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to regenerate"),
  });

  const columns = useMemo((): DataTableColumn<SnapshotItem & { index: number }>[] => {
    return [
      { id: "index", header: "#", flex: 0.3, cell: (row) => row.index },
      { id: "serial", header: "Serial", flex: 1.2, cell: (row) => row.bundleSerial },
      {
        id: "die",
        header: "Die",
        flex: 1,
        cell: (row) => `${row.die.series} / ${row.die.sectionCode}`,
      },
      { id: "group", header: "Group", flex: 0.8, cell: (row) => row.groupId || "None" },
      { id: "qty", header: "Qty", flex: 0.5, align: "right", cell: (row) => row.quantity },
      {
        id: "weight",
        header: "Weight (kg)",
        flex: 0.7,
        align: "right",
        cell: (row) => (row.weightG / 1000).toFixed(3),
      },
      {
        id: "length",
        header: `Length (${lu.label})`,
        flex: 0.7,
        align: "right",
        cell: (row) => lu.formatLength(row.lengthMm),
      },
    ];
  }, [lu]);

  if (isLoading) {
    return (
      <div className="p-8">
        <EmptyState title="Loading packing list…" />
      </div>
    );
  }
  if (!pl) {
    return (
      <div className="p-8">
        <EmptyState title="Packing list not found" />
      </div>
    );
  }

  const snap = pl.snapshot as unknown as PLSnapshot;
  const cust = snap.dispatch.customer;
  const tableRows = snap.items.map((item, index) => ({ ...item, index: index + 1 }));
  const groupTotals = Array.from(
    snap.items.reduce((map, item) => {
      const key = item.groupId || "UNGROUPED";
      const existing = map.get(key) ?? { label: key, bundles: 0, quantity: 0, weightG: 0, lengthMm: 0 };
      existing.bundles += 1;
      existing.quantity += item.quantity;
      existing.weightG += item.weightG;
      existing.lengthMm += item.lengthMm;
      map.set(key, existing);
      return map;
    }, new Map<string, { label: string; bundles: number; quantity: number; weightG: number; lengthMm: number }>()),
  ).map(([, value]) => value);

  async function handlePdf() {
    setPdfPending(true);
    try {
      await downloadPackingListPdf(snap, pl!.code, lu.unit);
    } catch {
      toast.error("PDF generation failed");
    } finally {
      setPdfPending(false);
    }
  }

  async function handleQrPdf() {
    setQrPdfPending(true);
    try {
      await downloadPackingListPdf(snap, pl!.code, lu.unit, { includeQr: true });
    } catch {
      toast.error("QR PDF generation failed");
    } finally {
      setQrPdfPending(false);
    }
  }

  async function handleXlsx() {
    setXlsxPending(true);
    try {
      await downloadPackingListXlsx(snap, pl!.code, lu.unit);
    } catch {
      toast.error("Excel export failed");
    } finally {
      setXlsxPending(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Packing lists"
        title={pl.code}
        description={
          <>
            Dispatch{" "}
            <Link
              to="/dispatches/$id"
              params={{ id: pl.dispatchId }}
              className="text-primary hover:underline font-mono"
            >
              {snap.dispatch.code}
            </Link>
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/dispatches/$id", params: { id: pl.dispatchId } })}
          >
            Back to dispatch
          </Button>
        }
      />

      <Card>
        <FactList>
          <Fact label="Customer" wide>
            <Truncate lines={2} className="font-medium">
              {cust.name}
            </Truncate>
            {cust.phone ? <span className="block text-sm text-muted-foreground">{cust.phone}</span> : null}
            {cust.email ? (
              <Truncate className="text-sm text-muted-foreground">{cust.email}</Truncate>
            ) : null}
            {cust.taxId ? (
              <Truncate className="text-sm text-muted-foreground">{`Tax ID: ${cust.taxId}`}</Truncate>
            ) : null}
          </Fact>
          <Fact label="Ship date">
            {snap.dispatch.shipDate ? format(new Date(snap.dispatch.shipDate), "PP") : "Not set"}
          </Fact>
          <Fact label="Dispatch" mono>
            {snap.dispatch.code}
          </Fact>
          <Fact label="Generated">{format(new Date(snap.generatedAt), "PP p")}</Fact>
          {snap.dispatch.notes ? (
            <Fact label="Notes" wide>
              {snap.dispatch.notes}
            </Fact>
          ) : null}
        </FactList>
      </Card>

      <section aria-label="Packing list totals" className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {[
          { label: "Bundles", value: snap.totals.totalBundles },
          { label: "Pieces", value: snap.totals.totalQuantity },
          { label: "Weight", value: `${snap.totals.totalWeightKg} kg` },
          { label: "Length", value: lu.formatLength(snap.totals.totalLengthM * 1000) },
        ].map(({ label, value }) => (
          <Card key={label} className="min-w-0 gap-1 p-4">
            <p className="m-0 truncate text-[13px] font-medium text-muted-foreground">{label}</p>
            <p className="m-0 truncate font-display text-[26px] font-extrabold leading-tight tracking-[-0.03em] tabular-nums text-foreground">
              {value}
            </p>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Packing groups</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={groupTotals}
            rowKey={(row) => row.label}
            columns={[
              { id: "group", header: "Group", cell: (row) => row.label },
              { id: "bundles", header: "Bundles", align: "right", cell: (row) => row.bundles },
              { id: "qty", header: "Pieces", align: "right", cell: (row) => row.quantity },
              { id: "weight", header: "Weight (kg)", align: "right", cell: (row) => (row.weightG / 1000).toFixed(3) },
              { id: "length", header: `Length (${lu.label})`, align: "right", cell: (row) => lu.formatLength(row.lengthMm) },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Button onClick={handlePdf} disabled={pdfPending} variant="outline">
          {pdfPending ? "Generating…" : "Download styled PDF"}
        </Button>
        <Button onClick={handleQrPdf} disabled={qrPdfPending} variant="outline">
          {qrPdfPending ? "Generating…" : "Download QR PDF"}
        </Button>
        <Button onClick={handleXlsx} disabled={xlsxPending} variant="outline">
          {xlsxPending ? "Exporting…" : "Download Excel"}
        </Button>
        <Can do="packingList.regenerate">
          <Button
            variant="ghost"
            disabled={regenMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Regenerate packing list? Current PDF data will be overwritten with live dispatch data.",
                )
              ) {
                regenMutation.mutate({ id: pl.id });
              }
            }}
          >
            {regenMutation.isPending ? "Regenerating…" : "Regenerate"}
          </Button>
        </Can>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items ({snap.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={tableRows}
            rowKey={(row) => `${row.bundleSerial}-${row.index}`}
            renderCard={(row) => (
              <ListCard
                mono
                className="bg-background"
                title={row.bundleSerial}
                titleText={row.bundleSerial}
                subtitle={`#${row.index} · ${row.die.series} / ${row.die.sectionCode}`}
                facts={[
                  { label: "Pieces", value: row.quantity.toLocaleString() },
                  { label: "Weight", value: `${(row.weightG / 1000).toFixed(3)} kg` },
                  { label: "Length", value: lu.formatLength(row.lengthMm) },
                ]}
                footer={<span className="min-w-0 truncate">Packing group {row.groupId || "not set"}</span>}
              />
            )}
            emptyState={<EmptyState title="No items in snapshot" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
