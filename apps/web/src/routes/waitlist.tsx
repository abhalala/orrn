import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";

import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/waitlist")({
  component: WaitlistComponent,
});

function WaitlistComponent() {
  const [isSuccess, setIsSuccess] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const waitlistMutation = useMutation({
    ...trpc.waitlist.submit.mutationOptions(),
    onSuccess: () => {
      setIsSuccess(true);
      setNetworkError(null);
    },
    onError: (error: any) => {
      setNetworkError(error.message || "An unexpected error occurred. Please try again.");
      toast.error(error.message || "An unexpected error occurred.");
    },
  });

  const form = useForm({
    defaultValues: {
      companyName: "",
      requesterName: "",
      requesterEmail: "",
      notes: "",
    },
    onSubmit: async ({ value }) => {
      waitlistMutation.mutate(value);
    },
    validators: {
      onSubmit: z.object({
        companyName: z.string().min(1, "Company Name is required"),
        requesterName: z.string().min(1, "Requester Name is required"),
        requesterEmail: z.string().email("Invalid email address"),
        notes: z.string(),
      }),
    },
  });

  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background dark:bg-background">
        <div className="w-full max-w-md p-8 rounded-lg border border-border bg-card shadow-sm space-y-4 text-center">
          <h2 className="text-2xl font-bold">Thank You!</h2>
          <p className="text-muted-foreground">
            We’ll review your request and email you within 1 business day.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <div className="w-full max-w-md p-8 rounded-lg border border-border bg-card shadow-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Join Waitlist</h1>
          <p className="text-muted-foreground">Request access to ORRN ERP.</p>
        </div>

        {networkError && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {networkError}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <div>
            <form.Field name="companyName">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Company Name *</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder="Acme Corp"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((error: any) => (
                    <p key={error?.toString()} className="text-sm text-destructive">
                      {error?.toString()}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          <div>
            <form.Field name="requesterName">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Requester Name *</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder="Jane Doe"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((error: any) => (
                    <p key={error?.toString()} className="text-sm text-destructive">
                      {error?.toString()}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          <div>
            <form.Field name="requesterEmail">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Requester Email *</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    placeholder="jane@example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.map((error: any) => (
                    <p key={error?.toString()} className="text-sm text-destructive">
                      {error?.toString()}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          <div>
            <form.Field name="notes">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Notes (Optional)</Label>
                  <textarea
                    id={field.name}
                    name={field.name}
                    rows={3}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Any specific requirements?"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>

          <form.Subscribe
            selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
          >
            {({ canSubmit }) => (
              <Button 
                type="submit" 
                className="w-full mt-2" 
                disabled={!canSubmit || waitlistMutation.isPending}
              >
                {waitlistMutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </div>
    </div>
  );
}
