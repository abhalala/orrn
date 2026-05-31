import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Calendar, CheckCircle2, Clock, Factory } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { trpc } from "@/shared/utils/trpc";

const waitlistSearchSchema = z.object({
  mode: z.enum(["waitlist", "demo"]).optional(),
});

export const Route = createFileRoute("/_public/waitlist")({
  component: WaitlistComponent,
  validateSearch: waitlistSearchSchema,
});

function WaitlistComponent() {
  const { mode } = Route.useSearch();
  const [requestType, setRequestType] = useState<"waitlist" | "demo">("demo");
  const [isSuccess, setIsSuccess] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  useEffect(() => {
    if (mode) setRequestType(mode);
  }, [mode]);

  const waitlistMutation = useMutation({
    ...trpc.waitlist.submit.mutationOptions(),
    onSuccess: () => {
      setIsSuccess(true);
      setNetworkError(null);
    },
    onError: (error: any) => {
      setNetworkError(error.message || "Request failed. Check the fields and try again.");
      toast.error(error.message || "Request failed. Check the fields and try again.");
    },
  });

  const form = useForm({
    defaultValues: {
      companyName: "",
      requesterName: "",
      requesterEmail: "",
      notes: "",
      demoDate: "",
      demoTime: "",
      pressCount: "",
    },
    onSubmit: async ({ value }) => {
      const finalNotes = requestType === "demo"
        ? [
            "[DEMO REQUEST]",
            `Preferred Date: ${value.demoDate || "Not scheduled"}`,
            `Preferred Time: ${value.demoTime || "Not scheduled"}`,
            `Extrusion Press Count: ${value.pressCount || "Not specified"}`,
            "----------------------------------------",
            `User Notes: ${value.notes || "None"}`,
          ].join("\n")
        : [
            "[WAITLIST ACCESS ONLY]",
            "----------------------------------------",
            `User Notes: ${value.notes || "None"}`,
          ].join("\n");

      waitlistMutation.mutate({
        companyName: value.companyName,
        requesterName: value.requesterName,
        requesterEmail: value.requesterEmail,
        notes: finalNotes,
      });
    },
    validators: {
      onSubmit: z.object({
        companyName: z.string().min(1, "Company name is required"),
        requesterName: z.string().min(1, "Your name is required"),
        requesterEmail: z.string().email("Enter a valid email address"),
        notes: z.string(),
        demoDate: z.string(),
        demoTime: z.string(),
        pressCount: z.string(),
      }),
    },
  });

  if (isSuccess) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md text-center">
          <CardContent className="items-center gap-5">
            <div className="mx-auto flex size-12 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 size={24} aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-foreground">Request Received</h1>
              <p className="text-sm leading-6 text-muted-foreground">
                {requestType === "demo"
                  ? "We will contact you to confirm the walkthrough slot."
                  : "We will review your profile and send an invitation when access is ready."}
              </p>
            </div>
            <Link to="/">
              <Button variant="outline" className="w-full">Back to Home</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Request ORRN Access</CardTitle>
          <CardDescription>Tell us how your extrusion operation should be onboarded.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1">
            <button
              type="button"
              onClick={() => setRequestType("demo")}
              className={`rounded-md px-3 py-2 text-sm font-medium ${requestType === "demo" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Schedule Demo
            </button>
            <button
              type="button"
              onClick={() => setRequestType("waitlist")}
              className={`rounded-md px-3 py-2 text-sm font-medium ${requestType === "waitlist" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Join Waitlist
            </button>
          </div>

          {networkError ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive" aria-live="polite">
              {networkError}
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField formApi={form} name="companyName" label="Company Name" placeholder="AluCorp Extrusion…" autoComplete="organization" />
              <TextField formApi={form} name="requesterName" label="Requester Name" placeholder="Jane Doe…" autoComplete="name" />
            </div>
            <TextField formApi={form} name="requesterEmail" label="Work Email" type="email" placeholder="jane@example.com…" autoComplete="email" />

            {requestType === "demo" ? (
              <div className="space-y-4 rounded-md border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Factory size={16} aria-hidden="true" />
                  Demo Context
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField formApi={form} name="demoDate" label="Preferred Date" type="date" icon={<Calendar size={14} aria-hidden="true" />} />
                  <TextField formApi={form} name="demoTime" label="Preferred Time" type="time" icon={<Clock size={14} aria-hidden="true" />} />
                </div>
                <TextField formApi={form} name="pressCount" label="Extrusion Lines" type="number" placeholder="3…" inputMode="numeric" />
              </div>
            ) : null}

            <form.Field name="notes">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor={field.name}>Additional Facility Notes</Label>
                  <textarea
                    id={field.name}
                    name={field.name}
                    rows={4}
                    className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Profiles, alloys, spooling requirements…"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit })}>
              {({ canSubmit }) => (
                <Button type="submit" className="w-full" disabled={!canSubmit || waitlistMutation.isPending}>
                  {waitlistMutation.isPending
                    ? "Submitting…"
                    : requestType === "demo"
                      ? "Request Demo"
                      : "Join Waitlist"}
                </Button>
              )}
            </form.Subscribe>
          </form>

          <div className="text-center">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Back to Home
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function TextField({
  formApi,
  name,
  label,
  icon,
  type,
  placeholder,
  autoComplete,
  inputMode,
  ...inputProps
}: {
  formApi: any;
  name: string;
  label: string;
  icon?: ReactNode;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
}) {
  return (
    <formApi.Field name={name}>
      {(field: any) => (
        <div className="space-y-1.5">
          <Label htmlFor={field.name} className="flex items-center gap-1.5">
            {icon}
            {label}
          </Label>
          <Input
            id={field.name}
            name={field.name}
            type={type}
            placeholder={placeholder}
            autoComplete={autoComplete}
            inputMode={inputMode}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)}
            {...inputProps}
          />
          {field.state.meta.errors.map((error: any) => (
            <p key={error?.toString()} className="text-xs text-destructive">
              {error?.toString()}
            </p>
          ))}
        </div>
      )}
    </formApi.Field>
  );
}
