import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Calendar, Clock, Factory, CheckCircle2 } from "lucide-react";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";

import { trpc } from "@/utils/trpc";

const waitlistSearchSchema = z.object({
  mode: z.enum(["waitlist", "demo"]).optional(),
});

export const Route = createFileRoute("/waitlist")({
  component: WaitlistComponent,
  validateSearch: waitlistSearchSchema,
});

function WaitlistComponent() {
  const { mode } = Route.useSearch();
  const [requestType, setRequestType] = useState<"waitlist" | "demo">("demo");
  const [isSuccess, setIsSuccess] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  // Sync state with incoming query params
  useEffect(() => {
    if (mode) {
      setRequestType(mode);
    }
  }, [mode]);

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
      demoDate: "",
      demoTime: "",
      pressCount: "",
    },
    onSubmit: async ({ value }) => {
      let finalNotes = value.notes;
      
      if (requestType === "demo") {
        const demoHeader = [
          `[DEMO REQUEST]`,
          `Preferred Date: ${value.demoDate || "Not scheduled"}`,
          `Preferred Time: ${value.demoTime || "Not scheduled"}`,
          `Extrusion Press Count: ${value.pressCount || "Not specified"}`,
          `----------------------------------------`,
          `User Notes: ${value.notes || "None"}`
        ].join("\n");
        finalNotes = demoHeader;
      } else {
        const waitlistHeader = [
          `[WAITLIST ACCESS ONLY]`,
          `----------------------------------------`,
          `User Notes: ${value.notes || "None"}`
        ].join("\n");
        finalNotes = waitlistHeader;
      }

      waitlistMutation.mutate({
        companyName: value.companyName,
        requesterName: value.requesterName,
        requesterEmail: value.requesterEmail,
        notes: finalNotes,
      });
    },
    validators: {
      onSubmit: z.object({
        companyName: z.string().min(1, "Company Name is required"),
        requesterName: z.string().min(1, "Your Name is required"),
        requesterEmail: z.string().email("Invalid email address"),
        notes: z.string(),
        demoDate: z.string(),
        demoTime: z.string(),
        pressCount: z.string(),
      }),
    },
  });

  if (isSuccess) {
    return (
      <div className="w-full max-w-md p-8 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md shadow-2xl space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight">Request Received</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {requestType === "demo"
              ? "We have scheduled your request for an enterprise walkthrough. A representative will contact you shortly to confirm your slot."
              : "You have successfully registered on the general access waitlist. We will review your profile and send an invitation code soon."}
          </p>
        </div>
        <div className="pt-4 border-t border-border/20">
          <Link to="/">
            <Button variant="outline" className="w-full border-border">Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg p-8 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md shadow-2xl space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">Access Portal</h1>
        <p className="text-sm text-muted-foreground">Request access to ORRN-AL for Aluminum Extrusion.</p>
      </div>

      {/* Segment Switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-[#090e1a]/60 rounded-xl border border-border/20">
        <button
          type="button"
          onClick={() => setRequestType("demo")}
          className={`py-2 text-xs font-semibold rounded-lg transition-all ${
            requestType === "demo"
              ? "bg-card text-foreground shadow-sm border border-border/10"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Schedule Live Demo
        </button>
        <button
          type="button"
          onClick={() => setRequestType("waitlist")}
          className={`py-2 text-xs font-semibold rounded-lg transition-all ${
            requestType === "waitlist"
              ? "bg-card text-foreground shadow-sm border border-border/10"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Join Waitlist Only
        </button>
      </div>

      {networkError && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="companyName">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor={field.name} className="text-xs font-medium">Company Name *</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="e.g. AluCorp Extrusion"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-xs text-destructive">
                    {error?.toString()}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Field name="requesterName">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor={field.name} className="text-xs font-medium">Requester Name *</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="Jane Doe"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-xs text-destructive">
                    {error?.toString()}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <form.Field name="requesterEmail">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor={field.name} className="text-xs font-medium">Work Email *</Label>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                placeholder="jane@alucorp.com"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.map((error: any) => (
                <p key={error?.toString()} className="text-xs text-destructive">
                  {error?.toString()}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        {/* Demo Specific Fields */}
        {requestType === "demo" && (
          <div className="space-y-4 border-t border-border/20 pt-4 animate-in fade-in duration-200">
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="demoDate">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor={field.name} className="text-xs font-medium flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-primary" />
                      Preferred Date
                    </Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="demoTime">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor={field.name} className="text-xs font-medium flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      Preferred Time
                    </Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="time"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="pressCount">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor={field.name} className="text-xs font-medium flex items-center gap-1">
                    <Factory className="h-3.5 w-3.5 text-accent" />
                    Number of Extrusion Lines
                  </Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="number"
                    placeholder="e.g. 3 lines"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>
        )}

        <form.Field name="notes">
          {(field) => (
            <div className="space-y-1.5 border-t border-border/20 pt-4">
              <Label htmlFor={field.name} className="text-xs font-medium">Additional Facility Notes (Optional)</Label>
              <textarea
                id={field.name}
                name={field.name}
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="List any special profiles, alloys, or spooling requirements..."
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
        >
          {({ canSubmit }) => (
            <Button
              type="submit"
              className="w-full mt-2"
              disabled={!canSubmit || waitlistMutation.isPending}
            >
              {waitlistMutation.isPending ? "Submitting Request..." : requestType === "demo" ? "Request Demo Access" : "Join Waitlist"}
            </Button>
          )}
        </form.Subscribe>
      </form>
      
      <div className="text-center pt-2">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors hover:underline">
          Back to Homepage
        </Link>
      </div>
    </div>
  );
}

