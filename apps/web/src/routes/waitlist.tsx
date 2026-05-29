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

import { trpc } from "@orrn/web-shared/utils/trpc";

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
      <div className="w-full max-w-md p-8 rounded-2xl border border-[#5B6CFF]/20 bg-[#121826]/70 backdrop-blur-xl shadow-2xl space-y-6 text-center relative overflow-hidden">
        {/* Top border highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />
        
        {/* Ambient glow inside */}
        <div className="absolute -top-12 -left-12 w-24 h-24 bg-[#5B6CFF]/10 rounded-full blur-xl pointer-events-none" />
        
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-[#22D3EE]">
            TRANSMISSION SECURED
          </span>
          <h2 className="text-2xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">Request Received</h2>
          <p className="text-xs text-muted-foreground leading-relaxed font-mono">
            {requestType === "demo"
              ? "We have scheduled your request for an enterprise walkthrough. A representative will contact you shortly to confirm your slot."
              : "You have successfully registered on the general access waitlist. We will review your profile and send an invitation code soon."}
          </p>
        </div>
        <div className="pt-4 border-t border-border/20">
          <Link to="/">
            <Button className="w-full bg-transparent hover:bg-muted/10 text-muted-foreground border border-border/40 h-10 rounded-lg font-semibold">
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg p-8 rounded-2xl border border-[#5B6CFF]/20 bg-[#121826]/70 backdrop-blur-xl shadow-2xl space-y-6 relative overflow-hidden">
      {/* Top border highlight */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />
      
      {/* Ambient background glows for card */}
      <div className="absolute top-[-5%] left-[-5%] w-32 h-32 bg-[#5B6CFF]/5 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute bottom-[-5%] right-[-5%] w-32 h-32 bg-[#22D3EE]/5 rounded-full blur-2xl pointer-events-none" />

      <div className="space-y-2 text-center">
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-[#22D3EE]">
          ORRN SYSTEM ACCESS
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">Access Portal</h1>
        <p className="text-xs text-muted-foreground font-mono">Request access to ORRN-AL for Aluminum Extrusion.</p>
      </div>

      {/* Segment Switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#0b0f1a]/85 rounded-xl border border-[#5B6CFF]/15">
        <button
          type="button"
          onClick={() => setRequestType("demo")}
          className={`py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            requestType === "demo"
              ? "bg-[#5B6CFF] text-white shadow-[0_0_12px_rgba(91,108,255,0.3)] border border-[#5B6CFF]/40"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          }`}
        >
          Schedule Live Demo
        </button>
        <button
          type="button"
          onClick={() => setRequestType("waitlist")}
          className={`py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            requestType === "waitlist"
              ? "bg-[#5B6CFF] text-white shadow-[0_0_12px_rgba(91,108,255,0.3)] border border-[#5B6CFF]/40"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          }`}
        >
          Join Waitlist Only
        </button>
      </div>

      {networkError && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono font-medium">
          ERROR // {networkError}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="companyName">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Company Name *</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="e.g. AluCorp Extrusion"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-xs text-destructive font-mono">
                    {error?.toString()}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Field name="requesterName">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Requester Name *</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="Jane Doe"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
                />
                {field.state.meta.errors.map((error: any) => (
                  <p key={error?.toString()} className="text-xs text-destructive font-mono">
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
              <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Work Email *</Label>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                placeholder="jane@alucorp.com"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
              />
              {field.state.meta.errors.map((error: any) => (
                <p key={error?.toString()} className="text-xs text-destructive font-mono">
                  {error?.toString()}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        {/* Demo Specific Fields */}
        {requestType === "demo" && (
          <div className="space-y-4 border-t border-border/20 pt-4 animate-in fade-in duration-200">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-xs text-[#22D3EE] leading-relaxed font-mono relative overflow-hidden mb-2">
              <div className="absolute top-0 right-0 bg-[#22D3EE]/10 text-[#22D3EE] text-[8px] font-bold px-2 py-0.5 rounded-bl">
                SCHEDULING ENGINE
              </div>
              <strong className="block mb-1 text-cyan-300">Live Walkthrough:</strong>
              Select a target slot. Our solutions engineers will configure a staging environment reflecting your capacity parameters to demonstrate the active spool scheduler.
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="demoDate">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-[#5B6CFF]" />
                      Preferred Date
                    </Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="demoTime">
                {(field) => (
                  <div className="space-y-1.5">
                    <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-[#5B6CFF]" />
                      Preferred Time
                    </Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="time"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="pressCount">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
                    <Factory className="h-3.5 w-3.5 text-[#22D3EE]" />
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
                    className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
                  />
                </div>
              )}
            </form.Field>
          </div>
        )}

        <form.Field name="notes">
          {(field) => (
            <div className="space-y-1.5 border-t border-border/20 pt-4">
              <Label htmlFor={field.name} className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Additional Facility Notes (Optional)</Label>
              <textarea
                id={field.name}
                name={field.name}
                rows={3}
                className="flex min-h-[80px] w-full rounded-lg border border-border/40 bg-[#0b0f1a]/60 px-3 py-2 text-sm text-[#f5f7ff] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5B6CFF] focus-visible:border-[#5B6CFF] disabled:cursor-not-allowed disabled:opacity-50 transition-all focus:shadow-[0_0_10px_rgba(91,108,255,0.15)] font-mono"
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
              className="w-full mt-2 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all duration-300 hover:scale-[1.01] hover:shadow-[#5B6CFF]/30 font-mono text-xs uppercase tracking-wider"
              disabled={!canSubmit || waitlistMutation.isPending}
            >
              {waitlistMutation.isPending 
                ? "Submitting..." 
                : requestType === "demo" 
                  ? "Request Demo Access" 
                  : "Join Waitlist"}
            </Button>
          )}
        </form.Subscribe>
      </form>
      
      <div className="text-center pt-2">
        <Link to="/" className="text-xs text-muted-foreground hover:text-[#5B6CFF] transition-colors font-mono hover:underline">
          &lt; Back to Homepage
        </Link>
      </div>
    </div>
  );
}


