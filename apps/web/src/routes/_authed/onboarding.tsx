import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Activity, CheckCircle, Clock, MapPin, Phone, Shield } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { requireSession } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_authed/onboarding")({
  beforeLoad: requireSession,
  component: OnboardingComponent,
});

function OnboardingComponent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"terms" | "profile" | "operations">("terms");
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [facilityLocation, setFacilityLocation] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [pressCount, setPressCount] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completeOnboardingMutation = useMutation(trpc.auth.completeOnboarding.mutationOptions());

  const handleNextStep = () => {
    if (step === "terms") {
      if (!termsAgreed) {
        toast.error("You must agree to the terms to proceed.");
        return;
      }
      setStep("profile");
    } else if (step === "profile") {
      if (!facilityLocation.trim()) {
        toast.error("Facility location is required.");
        return;
      }
      if (!primaryContact.trim()) {
        toast.error("Primary contact number is required.");
        return;
      }
      setStep("operations");
    }
  };

  const handleBackStep = () => {
    if (step === "profile") setStep("terms");
    else if (step === "operations") setStep("profile");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pressCount < 1) {
      toast.error("Press count must be at least 1");
      return;
    }

    setIsSubmitting(true);
    try {
      await completeOnboardingMutation.mutateAsync({
        facilityLocation,
        primaryContact,
        timezone,
        pressCount,
      });
      await queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      toast.success("Onboarding completed.");
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message || "Failed to complete onboarding");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          {step === "terms" && "Terms of Service"}
          {step === "profile" && "Facility Profile"}
          {step === "operations" && "Plant Parameters"}
        </CardTitle>
        <CardDescription>
          {step === "terms" && "Review the agreement for multi-company manufactured operations."}
          {step === "profile" && "Provide baseline plant and contact details."}
          {step === "operations" && "Configure extrusion capacity for floor workflows."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Stepper step={step} />

        {step === "terms" ? (
          <div className="space-y-5">
            <div className="max-h-60 space-y-4 overflow-y-auto rounded-md border border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
              <PolicyRow icon={<Shield size={16} aria-hidden="true" />} title="Terms & Conditions">
                Use ORRN according to your assigned company role, protect credentials, and keep tenant data inside the authorized workspace.
              </PolicyRow>
              <PolicyRow icon={<CheckCircle size={16} aria-hidden="true" />} title="Data Isolation and Privacy">
                Company data, extrusion logs, packing list configuration, and print audit events remain scoped to the active tenant.
              </PolicyRow>
              <PolicyRow icon={<Activity size={16} aria-hidden="true" />} title="Printing and Local Operations">
                LAN printing uses local `orrn-spool` services. Keep spool credentials protected and rotate them when staff access changes.
              </PolicyRow>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4">
              <input
                type="checkbox"
                checked={termsAgreed}
                onChange={(e) => setTermsAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary"
              />
              <span className="text-sm text-foreground">I agree to the terms and conditions.</span>
            </label>

            <Button onClick={handleNextStep} className="w-full" disabled={!termsAgreed}>
              Proceed to Profile
            </Button>
          </div>
        ) : null}

        {step === "profile" ? (
          <div className="space-y-5">
            <Field label="Facility / Plant Location" icon={<MapPin size={14} aria-hidden="true" />}>
              <Input
                id="facilityLocation"
                placeholder="Atlanta Press Facility, GA"
                value={facilityLocation}
                onChange={(e) => setFacilityLocation(e.target.value)}
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary Contact" icon={<Phone size={14} aria-hidden="true" />}>
                <Input
                  id="primaryContact"
                  type="tel"
                  placeholder="+1 (555) 019-2834"
                  value={primaryContact}
                  onChange={(e) => setPrimaryContact(e.target.value)}
                  required
                />
              </Field>
              <Field label="Operational Timezone" icon={<Clock size={14} aria-hidden="true" />}>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="America/New_York">Eastern Time (ET)</option>
                  <option value="America/Chicago">Central Time (CT)</option>
                  <option value="America/Denver">Mountain Time (MT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PT)</option>
                  <option value="UTC">Coordinated Universal Time (UTC)</option>
                </select>
              </Field>
            </div>

            <WizardActions onBack={handleBackStep} onNext={handleNextStep} nextDisabled={!facilityLocation || !primaryContact} nextLabel="Next: Capacity" />
          </div>
        ) : null}

        {step === "operations" ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-md border border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
              Set active extrusion press lines. This seeds scheduling and press queue defaults for the tenant.
            </div>
            <Field label="Active Extrusion Press Lines" icon={<Activity size={14} aria-hidden="true" />}>
              <Input
                id="pressCount"
                type="number"
                min={1}
                max={50}
                value={pressCount}
                onChange={(e) => setPressCount(parseInt(e.target.value) || 0)}
                required
              />
            </Field>
            <div className="flex gap-3 border-t border-border pt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={handleBackStep}>Back</Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? "Completing…" : "Complete Onboarding"}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

const STEP_META = [
  { key: "terms", label: "Terms" },
  { key: "profile", label: "Profile" },
  { key: "operations", label: "Capacity" },
] as const;

function Stepper({ step }: { step: "terms" | "profile" | "operations" }) {
  const activeIndex = STEP_META.findIndex((s) => s.key === step);
  return (
    <ol className="mb-4 flex items-center gap-2" aria-label="Onboarding progress">
      {STEP_META.map((meta, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
        return (
          <li key={meta.key} className="flex flex-1 items-center gap-2" aria-current={state === "active" ? "step" : undefined}>
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-[var(--dur-base)] ${
                state === "todo"
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {state === "done" ? <CheckCircle size={13} aria-hidden="true" /> : index + 1}
            </span>
            <span
              className={`hidden text-xs font-medium sm:block ${
                state === "todo" ? "text-muted-foreground" : "text-foreground"
              }`}
            >
              {meta.label}
            </span>
            <span
              className={`h-1 flex-1 rounded-full transition-colors duration-[var(--dur-base)] ${
                index <= activeIndex ? "bg-primary" : "bg-muted"
              }`}
              aria-hidden="true"
            />
          </li>
        );
      })}
    </ol>
  );
}

function PolicyRow({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h3>
      <p>{children}</p>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}

function WizardActions({
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  nextLabel: string;
}) {
  return (
    <div className="flex gap-3 border-t border-border pt-4">
      <Button variant="outline" className="flex-1" onClick={onBack}>Back</Button>
      <Button className="flex-1" onClick={onNext} disabled={nextDisabled}>{nextLabel}</Button>
    </div>
  );
}
