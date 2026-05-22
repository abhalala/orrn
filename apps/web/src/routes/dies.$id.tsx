import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { Can } from "@/components/can";
import { requireCompanyMe } from "@/lib/route-guards";

const dieStatuses = ["active", "archived"] as const;

export const Route = createFileRoute("/dies/$id")({
  component: DieFormComponent,
  beforeLoad: requireCompanyMe,
});

function DieFormComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const isNew = id === "new";

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
    onError: (error: any) => {
      toast.error(error.message || "Failed to create die");
    }
  });

  const updateMutation = useMutation({
    ...trpc.die.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Die updated");
      navigate({ to: "/dies" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update die");
    }
  });

  const deleteMutation = useMutation({
    ...trpc.die.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Die deleted");
      navigate({ to: "/dies" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete die");
    }
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
      if (isNew) {
        createMutation.mutate(value);
      } else {
        updateMutation.mutate({ id, ...value });
      }
    },
    validators: {
      onSubmit: z.object({
        series: z.string().min(1, "Series is required"),
        sectionCode: z.string().min(1, "Section Code is required"),
        name: z.string(),
        dimensions: z.any(),
        weightMinG: z.number().min(0, "Min weight must be >= 0"),
        weightMaxG: z.number().min(0, "Max weight must be >= 0"),
        status: z.enum(dieStatuses),
        notes: z.string(),
      }),
    },
  });

  if (!isNew && isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this die?")) {
      deleteMutation.mutate({ id });
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{isNew ? "New Die" : "Edit Die"}</h1>
        </div>
        {!isNew && (
          <Can do="die.delete">
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              Delete
            </Button>
          </Can>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4 bg-card p-6 border rounded-lg"
      >
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="series">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Series *</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-sm text-destructive">{error?.toString()}</p>
                ))}
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
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-sm text-destructive">{error?.toString()}</p>
                ))}
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
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="weightMinG">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Min Weight (g) *</Label>
                <Input
                  id={field.name}
                  type="number"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-sm text-destructive">{error?.toString()}</p>
                ))}
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
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-sm text-destructive">{error?.toString()}</p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div className="space-y-2 border p-4 rounded-md">
          <Label>Dimensions (mm)</Label>
          <div className="grid grid-cols-3 gap-4">
            <form.Field name="dimensions.widthMm">
              {(field) => (
                <div className="space-y-1">
                  <Label htmlFor={field.name} className="text-xs text-muted-foreground">Width</Label>
                  <Input
                    id={field.name}
                    type="number"
                    value={field.state.value || ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="dimensions.heightMm">
              {(field) => (
                <div className="space-y-1">
                  <Label htmlFor={field.name} className="text-xs text-muted-foreground">Height</Label>
                  <Input
                    id={field.name}
                    type="number"
                    value={field.state.value || ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="dimensions.thicknessMm">
              {(field) => (
                <div className="space-y-1">
                  <Label htmlFor={field.name} className="text-xs text-muted-foreground">Thickness</Label>
                  <Input
                    id={field.name}
                    type="number"
                    value={field.state.value || ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
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
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value as any)}
              >
                {dieStatuses.map(status => (
                  <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>
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
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <div className="pt-4 flex justify-end space-x-2">
          <Button variant="outline" type="button" onClick={() => navigate({ to: "/dies" })}>
            Cancel
          </Button>
          <Can do={isNew ? "die.create" : "die.update"}>
            <form.Subscribe
              selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
            >
              {({ canSubmit }) => (
                <Button type="submit" disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Die"}
                </Button>
              )}
            </form.Subscribe>
          </Can>
        </div>
      </form>
    </div>
  );
}
