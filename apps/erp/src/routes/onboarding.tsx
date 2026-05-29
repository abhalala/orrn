import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { requireSession } from "@orrn/web-shared/lib/erp-guards";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: requireSession,
  component: OnboardingComponent,
});

function OnboardingComponent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"terms" | "profile" | "operations">("terms");
  
  // Step 1 states
  const [termsAgreed, setTermsAgreed] = useState(false);
  
  // Step 2 states
  const [facilityLocation, setFacilityLocation] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  
  // Step 3 states
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pressCount < 0) {
      toast.error("Press count cannot be negative");
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

      // Clear layout and me caches to ensure fresh onboarding state is loaded globally
      await queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      
      toast.success("Onboarding completed successfully!");
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message || "Failed to complete onboarding");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-4 bg-[#0b0f1a] overflow-hidden w-full">
      {/* Background mesh glow */}
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-gradient-to-r from-[#5B6CFF]/15 to-[#22D3EE]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-gradient-to-l from-[#22D3EE]/10 to-[#5B6CFF]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-[0.15] pointer-events-none -z-10" />

      <div className="w-full max-w-2xl space-y-8 rounded-2xl border border-[#5B6CFF]/20 bg-[#121826]/70 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 relative overflow-hidden">
        {/* Top border highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />
        
        {/* Header */}
        <div className="space-y-2 text-center">
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-[#22D3EE]">
            ORRN-AL Plant Initialization
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">
            {step === "terms" && "Terms of Service"}
            {step === "profile" && "Facility Profile Setup"}
            {step === "operations" && "Extrusion Plant Parameters"}
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            {step === "terms" && "Review the licensing agreement for multi-company manufactured operations."}
            {step === "profile" && "Provide baseline geographical and contact details for this plant."}
            {step === "operations" && "Configure operational capacities specific to your aluminum extrusion presses."}
          </p>
        </div>

        {/* Multi-step progress navigation bar */}
        <div className="flex items-center justify-between px-4 max-w-md mx-auto relative py-2 w-full">
          {/* Step line connector */}
          <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-muted/20 -translate-y-1/2 -z-10" />
          <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-gradient-to-r from-[#5B6CFF] to-transparent -translate-y-1/2 -z-10 transition-all duration-500" 
               style={{ 
                 width: step === "terms" ? "0%" : step === "profile" ? "50%" : "100%",
                 background: step === "terms" ? "transparent" : `linear-gradient(to right, #5B6CFF, ${step === "operations" ? "#22D3EE" : "#5B6CFF"})`
               }} 
          />

          <button
            type="button"
            onClick={() => termsAgreed && setStep("terms")}
            className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
              step === "terms" 
                ? "bg-[#5B6CFF] border-[#5B6CFF] text-white shadow-[0_0_10px_#5B6CFF]" 
                : "bg-[#0b0f1a] border-[#5B6CFF]/40 text-[#bdc2ff]"
            }`}
          >
            1
          </button>

          <button
            type="button"
            onClick={() => termsAgreed && facilityLocation && primaryContact && setStep("profile")}
            disabled={!termsAgreed}
            className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
              step === "profile" 
                ? "bg-[#5B6CFF] border-[#5B6CFF] text-white shadow-[0_0_10px_#5B6CFF]" 
                : step === "operations" 
                  ? "bg-[#5B6CFF]/20 border-[#5B6CFF] text-[#bdc2ff]" 
                  : "bg-[#0b0f1a] border-border/40 text-muted-foreground"
            }`}
          >
            2
          </button>

          <button
            type="button"
            disabled={!termsAgreed || !facilityLocation || !primaryContact}
            className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
              step === "operations" 
                ? "bg-[#22D3EE] border-[#22D3EE] text-[#062a33] shadow-[0_0_10px_#22D3EE]" 
                : "bg-[#0b0f1a] border-border/40 text-muted-foreground"
            }`}
          >
            3
          </button>
        </div>

        {/* Content Wizard */}
        <div className="space-y-6">
          {step === "terms" && (
            <div className="space-y-5">
              <div className="h-52 overflow-y-auto rounded-xl border border-border/10 bg-[#0b0f1a]/80 p-5 text-[11px] leading-relaxed text-muted-foreground shadow-inner select-none font-mono">
                <h3 className="mb-2 font-bold text-[#f5f7ff] text-xs">1. Terms & Conditions</h3>
                <p className="mb-4">
                  Welcome to ORRN-AL. By utilizing this Software-as-a-Service system for your manufacturing operations, you agree to safeguard security tokens, respect tenant boundaries, and enforce proper role-based authorization parameters on your local spool network.
                </p>
                <h3 className="mb-2 font-bold text-[#f5f7ff] text-xs">2. Data Isolation and Privacy</h3>
                <p className="mb-4">
                  ORRN enforces logical multi-tenant database isolation. Your company data, extrusion logs, packing list configurations, and spool audit events are restricted to your tenant context and never cached across tenants.
                </p>
                <h3 className="mb-2 font-bold text-[#f5f7ff] text-xs">3. Spool Webhooks and Local Printing</h3>
                <p>
                  Any print queuing triggers LAN `orrn-spool` integrations. Ensure that your spool API key remains wrapped and encrypted at all times to prevent malicious access to physical print operations.
                </p>
              </div>

              <label className="flex items-center space-x-3 cursor-pointer rounded-xl border border-[#5B6CFF]/20 bg-[#0b0f1a]/40 p-4 hover:bg-[#0b0f1a]/60 transition-colors select-none">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  className="h-4.5 w-4.5 rounded border-border/45 bg-[#0b0f1a] text-[#5B6CFF] focus:ring-[#5B6CFF]"
                />
                <span className="text-xs font-semibold text-muted-foreground font-mono">
                  I Agree and Consent to the terms and conditions outlined above
                </span>
              </label>

              <Button
                onClick={handleNextStep}
                className="w-full bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all hover:scale-[1.01]"
                disabled={!termsAgreed}
              >
                Proceed to Profile Setup
              </Button>
            </div>
          )}

          {step === "profile" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="facilityLocation" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Facility / Plant Location</Label>
                <Input
                  id="facilityLocation"
                  placeholder="e.g. Atlanta Press Facility, GA"
                  value={facilityLocation}
                  onChange={(e) => setFacilityLocation(e.target.value)}
                  required
                  className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="primaryContact" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Primary Contact Number</Label>
                  <Input
                    id="primaryContact"
                    type="tel"
                    placeholder="+1 (555) 019-2834"
                    value={primaryContact}
                    onChange={(e) => setPrimaryContact(e.target.value)}
                    required
                    className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Operational Timezone</Label>
                  <select
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-border/40 bg-[#0b0f1a]/60 px-3 py-2 text-sm text-[#f5f7ff] ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5B6CFF] focus-visible:border-[#5B6CFF] disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="UTC">Coordinated Universal Time (UTC)</option>
                  </select>
                </div>
              </div>

              <div className="flex space-x-3 pt-2">
                <Button
                  onClick={handleBackStep}
                  className="flex-1 bg-transparent hover:bg-muted/10 text-muted-foreground border border-border/40 h-10 rounded-lg font-semibold"
                >
                  Back
                </Button>
                <Button
                  onClick={handleNextStep}
                  className="flex-1 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg border border-white/5"
                  disabled={!facilityLocation || !primaryContact}
                >
                  Next: Capacity Setup
                </Button>
              </div>
            </div>
          )}

          {step === "operations" && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-xs text-[#22D3EE] leading-relaxed font-mono relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-[#22D3EE]/10 text-[#22D3EE] text-[8px] font-bold px-2 py-0.5 rounded-bl">
                  CAPACITY ENGINE
                </div>
                <strong className="block mb-1 text-cyan-300">ORRN-AL Extrusion Mode:</strong>
                Define the count of extrusion press lines available at your plant. This dictates scheduling workflows, die allocation grids, and press queue parameters dynamically.
              </div>

              <div className="space-y-2">
                <Label htmlFor="pressCount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">Active Extrusion Press Lines Count</Label>
                <Input
                  id="pressCount"
                  type="number"
                  min={1}
                  max={50}
                  value={pressCount}
                  onChange={(e) => setPressCount(parseInt(e.target.value) || 0)}
                  required
                  className="bg-[#0b0f1a]/60 border-border/40 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg font-mono"
                />
              </div>

              <div className="flex space-x-3 pt-2">
                <Button
                  type="button"
                  onClick={handleBackStep}
                  className="flex-1 bg-transparent hover:bg-muted/10 text-muted-foreground border border-border/40 h-10 rounded-lg font-semibold"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all hover:scale-[1.01]"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Completing Onboarding..." : "Complete Onboarding"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
