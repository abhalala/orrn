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

import { Can } from "@orrn/web-shared/components/can";
import { useLengthUnit } from "@orrn/web-shared/lib/length";
import { requireCompanyMe } from "@orrn/web-shared/lib/erp-guards";
import { trpc } from "@orrn/web-shared/utils/trpc";

const dieStatuses = ["active", "archived"] as const;

export const Route = createFileRoute("/dies/$id")({
  component: DieFormComponent,
  beforeLoad: requireCompanyMe,
});

function DieFormComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const isNew = id === "new";
  const lu = useLengthUnit();

  const { data: die, isLoading } = useQuery({
    ...trpc.die.get.queryOptions({ id }),
    enabled: !isNew,
  });

  const createMutation = useMutation({
    ...trpc.die.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Die created");
      navigate({ to: "/dies" });
    },
    onError: (error: any) => toast.error(error.message || "Failed to create die"),
  });

  const updateMutation = useMutation({
    ...trpc.die.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Die updated");
      navigate({ to: "/dies" });
    },
    onError: (error: any) => toast.error(error.message || "Failed to update die"),
  });

  const deleteMutation = useMutation({
    ...trpc.die.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Die deleted");
      navigate({ to: "/dies" });
    },
    onError: (error: any) => toast.error(error.message || "Failed to delete die"),
  });

  const form = useForm({
    defaultValues: {
      series: die?.series || "",
      sectionCode: die?.sectionCode || "",
      name: die?.name || "",
      dimensions: {
        widthMm: die?.dimensions?.widthMm as number | undefined,
        heightMm: die?.dimensions?.heightMm as number | undefined,
        thicknessMm: die?.dimensions?.thicknessMm as number | undefined,
      },
      weightMinG: die?.weightMinG || 0,
      weightMaxG: die?.weightMaxG || 0,
      status: die?.status || "active",
      notes: die?.notes || "",
    },
    onSubmit: async ({ value }) => {
      if (isNew) createMutation.mutate(value);
      else updateMutation.mutate({ id, ...value });
    },
    validators: {
      onSubmit: z.object({
        series: z.string().min(1, "Series is required"),
        sectionCode: z.string().min(1, "Section Code is required"),
        name: z.string(),
        dimensions: z.any(),
        weightMinG: z.number().min(0),
        weightMaxG: z.number().min(0),
        status: z.enum(dieStatuses),
        notes: z.string(),
      }),
    },
  });

  if (!isNew && isLoading) return <div>Loading…</div>;

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this die?")) {
      deleteMutation.mutate({ id });
    }
  };

  const fieldError = (errors: unknown[]) =>
    errors.map((error: any) => (
      <p key={error?.toString()} className="text-sm text-destructive">
        {error?.toString()}
      </p>
    ));

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Dies"
        title={isNew ? "New die" : die ? `${die.series} / ${die.sectionCode}` : "Edit die"}
        actions={
          !isNew && (
            <Can do="die.delete">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <form.Field name="series">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Series *</Label>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                    />
                    {fieldError(field.state.meta.errors)}
                  </div>
                )}
              </form.Field>

              <form.Field name="sectionCode">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Section Code *</Label>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                    />
                    {fieldError(field.state.meta.errors)}
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChangeText={field.handleChange}
                  />
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <form.Field name="weightMinG">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Min Weight (g) *</Label>
                    <Input
                      id={field.name}
                      type="number"
                      value={String(field.state.value ?? "")}
                      onBlur={field.handleBlur}
                      onChangeText={(text) => field.handleChange(Number(text))}
                    />
                    {fieldError(field.state.meta.errors)}
                  </div>
                )}
              </form.Field>

              <form.Field name="weightMaxG">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Max Weight (g) *</Label>
                    <Input
                      id={field.name}
                      type="number"
                      value={String(field.state.value ?? "")}
                      onBlur={field.handleBlur}
                      onChangeText={(text) => field.handleChange(Number(text))}
                    />
                    {fieldError(field.state.meta.errors)}
                  </div>
                )}
              </form.Field>
            </div>

            <div className="space-y-2 border border-border p-4 rounded-md">
              <Label>Dimensions ({lu.label})</Label>
              <div className="grid grid-cols-3 gap-4">
                <form.Field name="dimensions.widthMm">
                  {(field) => (
                    <div className="space-y-1">
                      <Label htmlFor={field.name} className="text-xs text-muted-foreground">
                        Width
                      </Label>
                      <Input
                        id={field.name}
                        type="number"
                        value={field.state.value != null ? lu.formatLengthValue(field.state.value) : ""}
                        onBlur={field.handleBlur}
                        onChangeText={(text) => field.handleChange(text ? lu.parseLengthDecimal(text) : undefined)}
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name="dimensions.heightMm">
                  {(field) => (
                    <div className="space-y-1">
                      <Label htmlFor={field.name} className="text-xs text-muted-foreground">
                        Height
                      </Label>
                      <Input
                        id={field.name}
                        type="number"
                        value={field.state.value != null ? lu.formatLengthValue(field.state.value) : ""}
                        onBlur={field.handleBlur}
                        onChangeText={(text) => field.handleChange(text ? lu.parseLengthDecimal(text) : undefined)}
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name="dimensions.thicknessMm">
                  {(field) => (
                    <div className="space-y-1">
                      <Label htmlFor={field.name} className="text-xs text-muted-foreground">
                        Thickness
                      </Label>
                      <Input
                        id={field.name}
                        type="number"
                        value={field.state.value != null ? lu.formatLengthValue(field.state.value) : ""}
                        onBlur={field.handleBlur}
                        onChangeText={(text) => field.handleChange(text ? lu.parseLengthDecimal(text) : undefined)}
                      />
                    </div>
                  )}
                </form.Field>
              </div>
            </div>

            <form.Field name="status">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Status</Label>
                  <select
                    id={field.name}
                    className="flex h-9 w-full max-w-[200px] items-center justify-between rounded-md border border-border bg-background px-3 text-sm"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value as any)}
                  >
                    {dieStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </option>
                    ))}
                  </select>
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

            <div className="pt-4 flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => navigate({ to: "/dies" })}>
                Cancel
              </Button>
              <Can do={isNew ? "die.create" : "die.update"}>
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
                      {createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save Die"}
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
