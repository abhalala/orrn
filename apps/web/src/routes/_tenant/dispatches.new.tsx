import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardFooter } from "@orrn/ui/components/card";
import { Input, TextArea } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/dispatches/new")({
  component: NewDispatchComponent,
  beforeLoad: requireCompanyMe,
});

function NewDispatchComponent() {
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: customersData } = useQuery({
    ...trpc.customer.list.queryOptions({ limit: 100, offset: 0 }),
  });

  const createMutation = useMutation({
    ...trpc.dispatch.create.mutationOptions(),
    onSuccess: (res) => {
      toast.success(`Dispatch ${res.code} created`);
      navigate({ to: "/dispatches/$id", params: { id: res.id } });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create dispatch");
    },
  });

  const customerOptions =
    customersData?.items.map((c) => ({ label: c.name, value: c.id })) ?? [];

  const handleSubmit = () => {
    if (!customerId) {
      toast.error("Select a customer");
      return;
    }
    const shipMs = shipDate ? new Date(shipDate).getTime() : undefined;
    createMutation.mutate({
      customerId,
      shipDate: shipMs ?? null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        eyebrow="Dispatches"
        title="New dispatch"
        description="Start a draft. You can add bundles on the next screen."
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="customer">Customer *</Label>
            <Select
              value={customerId}
              onValueChange={setCustomerId}
              options={customerOptions}
              placeholder="Select a customer…"
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shipDate">Ship date</Label>
            <Input id="shipDate" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <TextArea
              id="notes"
              rows={3}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional"
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/dispatches", search: { status: "all" } })}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create draft"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
