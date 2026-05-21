import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";

export const Route = createFileRoute("/dispatches/new")({
  component: NewDispatchComponent,
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
    onSuccess: (res: any) => {
      toast.success(`Dispatch ${res.code} created`);
      navigate({ to: "/dispatches/$id", params: { id: res.id } });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create dispatch");
    },
  });

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
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">New Dispatch</h1>
          <p className="text-muted-foreground">Start a draft. You can add bundles next.</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/dispatches", search: { status: "all" } })}>
          Cancel
        </Button>
      </div>

      <section className="bg-card border rounded-lg p-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="customer">Customer *</Label>
          <select
            id="customer"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Select a customer...</option>
            {customersData?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shipDate">Ship Date</Label>
          <Input
            id="shipDate"
            type="date"
            value={shipDate}
            onChange={(e) => setShipDate(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            rows={3}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate({ to: "/dispatches", search: { status: "all" } })}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create draft"}
        </Button>
      </div>
    </div>
  );
}
