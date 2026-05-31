import { Button } from "@orrn/ui/components/button";
import { Card, CardContent } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { Can } from "@/shared/components/can";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/customers/$id")({
  component: CustomerFormComponent,
  beforeLoad: requireCompanyMe,
});

function CustomerFormComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const isNew = id === "new";

  const { data: customer, isLoading } = useQuery({
    ...trpc.customer.get.queryOptions({ id }),
    enabled: !isNew,
  });

  const createMutation = useMutation({
    ...trpc.customer.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Customer created");
      navigate({ to: "/customers" });
    },
    onError: (error: any) => toast.error(error.message || "Failed to create customer"),
  });

  const updateMutation = useMutation({
    ...trpc.customer.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Customer updated");
      navigate({ to: "/customers" });
    },
    onError: (error: any) => toast.error(error.message || "Failed to update customer"),
  });

  const deleteMutation = useMutation({
    ...trpc.customer.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Customer deleted");
      navigate({ to: "/customers" });
    },
    onError: (error: any) => toast.error(error.message || "Failed to delete customer"),
  });

  const form = useForm({
    defaultValues: {
      name: customer?.name || "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      taxId: customer?.taxId || "",
      notes: customer?.notes || "",
    },
    onSubmit: async ({ value }) => {
      if (isNew) createMutation.mutate(value);
      else updateMutation.mutate({ id, ...value });
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Name is required"),
        email: z.string().email("Invalid email").or(z.literal("")),
        phone: z.string(),
        taxId: z.string(),
        notes: z.string(),
      }),
    },
  });

  if (!isNew && isLoading) return <div>Loading…</div>;

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this customer?")) {
      deleteMutation.mutate({ id });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Customers"
        title={isNew ? "New customer" : customer?.name || "Edit customer"}
        actions={
          !isNew && (
            <Can do="customer.delete">
              <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
                Delete
              </Button>
            </Can>
          )
        }
      />

      <Card>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Name *</Label>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChangeText={field.handleChange}
                    placeholder="Acme Corp"
                  />
                  {field.state.meta.errors.map((error: any) => (
                    <p key={error?.toString()} className="text-sm text-destructive">
                      {error?.toString()}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <form.Field name="email">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Email</Label>
                    <Input
                      id={field.name}
                      type="email"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                      placeholder="contact@acme.com"
                    />
                    {field.state.meta.errors.map((error: any) => (
                      <p key={error?.toString()} className="text-sm text-destructive">
                        {error?.toString()}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>
              <form.Field name="phone">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Phone</Label>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="taxId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Tax ID</Label>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChangeText={field.handleChange}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="notes">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Notes</Label>
                  <textarea
                    id={field.name}
                    rows={4}
                    className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>

            <div className="pt-4 flex justify-end space-x-2">
              <Button variant="outline" type="button" onClick={() => navigate({ to: "/customers" })}>
                Cancel
              </Button>
              <Can do={isNew ? "customer.create" : "customer.update"}>
                <form.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ canSubmit }) => (
                    <Button
                      type="submit"
                      disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
                    >
                      {createMutation.isPending || updateMutation.isPending
                        ? "Saving…"
                        : "Save Customer"}
                    </Button>
                  )}
                </form.Subscribe>
              </Can>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
