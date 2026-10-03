import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader } from "@orrn/ui/components/card";
import { Input, TextArea } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Calendar, CheckCircle2, Clock, Factory } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AuthScreen } from "@/shared/components/auth-screen";
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
      <AuthScreen>
        <Card className="w-full max-w-md gap-6 p-6 text-center shadow-md sm:p-8">
          <CardContent className="items-center gap-5" role="status">
            <div className="orrn-pop mx-auto flex size-16 items-center justify-center rounded-full bg-tone-green-tint text-tone-green-ink">
              <CheckCircle2 size={30} aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h1 className="orrn-auth-title">Request received</h1>
              <p className="m-0 text-[15px] leading-6 text-muted-foreground">
                {requestType === "demo"
                  ? "We will contact you to confirm the walkthrough slot."
                  : "We will review your profile and send an invitation when access is ready."}
              </p>
            </div>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link to="/">Back to home</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Card className="w-full max-w-xl gap-6 p-6 shadow-md sm:p-8">
        <CardHeader className="gap-2">
          <h1 className="orrn-auth-title">Request ORRN access</h1>
          <CardDescription className="text-[15px] leading-6">
            Tell us how your extrusion operation should be onboarded.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-5">
          <div
            className="grid grid-cols-2 gap-1 rounded-full bg-surface-sunken p-1 dark:bg-background dark:ring-1 dark:ring-border"
            role="group"
            aria-label="Request type"
          >
            <button
              type="button"
              aria-pressed={requestType === "demo"}
              onClick={() => setRequestType("demo")}
              className={`h-11 rounded-full px-3 text-sm font-semibold transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] ${requestType === "demo" ? "bg-card text-foreground shadow-sm dark:bg-popover" : "text-muted-foreground hover:text-foreground"}`}
            >
              Schedule demo
            </button>
            <button
              type="button"
              aria-pressed={requestType === "waitlist"}
              onClick={() => setRequestType("waitlist")}
              className={`h-11 rounded-full px-3 text-sm font-semibold transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] ${requestType === "waitlist" ? "bg-card text-foreground shadow-sm dark:bg-popover" : "text-muted-foreground hover:text-foreground"}`}
            >
              Join waitlist
            </button>
          </div>

          <div aria-live="polite">
            {networkError ? (
              <div className="rounded-input bg-tone-red-tint px-3.5 py-2.5 text-sm font-medium text-tone-red-ink">
                {networkError}
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField formApi={form} name="companyName" label="Company name" placeholder="AluCorp Extrusion…" autoComplete="organization" />
              <TextField formApi={form} name="requesterName" label="Requester name" placeholder="Jane Doe…" autoComplete="name" />
            </div>
            <TextField formApi={form} name="requesterEmail" label="Work email" type="email" placeholder="jane@example.com…" autoComplete="email" />

            {requestType === "demo" ? (
              <fieldset className="min-w-0 space-y-4 rounded-card border border-border bg-background p-4">
                <legend className="sr-only">Demo details</legend>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground" aria-hidden="true">
                  <Factory size={16} aria-hidden="true" />
                  Demo details
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField formApi={form} name="demoDate" label="Preferred date" type="date" icon={<Calendar size={14} aria-hidden="true" />} />
                  <TextField formApi={form} name="demoTime" label="Preferred time" type="time" icon={<Clock size={14} aria-hidden="true" />} />
                </div>
                <TextField formApi={form} name="pressCount" label="Extrusion lines" type="number" placeholder="3…" inputMode="numeric" />
              </fieldset>
            ) : null}

            <form.Field name="notes">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor={field.name}>Additional facility notes</Label>
                  <TextArea
                    id={field.name}
                    name={field.name}
                    rows={4}
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
                <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || waitlistMutation.isPending}>
                  {waitlistMutation.isPending
                    ? "Submitting…"
                    : requestType === "demo"
                      ? "Request demo"
                      : "Join waitlist"}
                </Button>
              )}
            </form.Subscribe>
          </form>

          <div className="text-center">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
            >
              Back to home
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthScreen>
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
            <p key={error?.toString()} className="m-0 text-[13px] font-medium text-destructive" role="alert">
              {error?.toString()}
            </p>
          ))}
        </div>
      )}
    </formApi.Field>
  );
}
