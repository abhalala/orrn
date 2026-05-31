import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle, MapPin, Phone, Clock, ArrowRight, Shield, Activity, ChevronRight } from "lucide-react";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { requireSession } from "@orrn/web-shared/lib/erp-guards";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: requireSession,
  component: OnboardingComponent,
});

function OrrnLogo() {
  return (
    <svg className="w-10 h-10 mx-auto filter drop-shadow-[0_0_8px_rgba(91,108,255,0.5)]" viewBox="0 0 100 100" fill="none">
      <polygon points="50,15 85,35 85,75 50,95 15,75 15,35" fill="none" stroke="#5B6CFF" strokeWidth="4" />
      <polygon points="50,25 75,40 75,70 50,85 25,70 25,40" fill="none" stroke="#22D3EE" strokeWidth="2" opacity="0.8" />
      <polygon points="50,40 60,50 50,60 40,50" fill="#5B6CFF" />
    </svg>
  );
}

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

      <div className="w-full max-w-2xl space-y-8 rounded-2xl border border-white/10 bg-[#121826]/40 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 relative overflow-hidden">
        {/* Top border highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#5B6CFF]/35 to-transparent" />
        
        {/* Header */}
        <div className="space-y-2 text-center">
          <OrrnLogo />
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] text-[#22D3EE] block mt-2">
            ORRN-AL Plant Initialization
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-sans">
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

        {/* Stepper Navigation Bar */}
        <div className="flex items-center justify-between px-6 max-w-md mx-auto relative py-2 w-full">
          {/* Step line connector */}
          <div className="absolute top-1/2 left-6 right-6 h-[2px] bg-white/5 -translate-y-1/2 -z-10" />
          <div className="absolute top-1/2 left-6 right-6 h-[2px] -translate-y-1/2 -z-10 transition-all duration-500" 
               style={{ 
                 width: step === "terms" ? "0%" : step === "profile" ? "42%" : "84%",
                 background: `linear-gradient(to right, #5B6CFF, ${step === "operations" ? "#22D3EE" : "#5B6CFF"})`
               }} 
          />

          <button
            type="button"
            onClick={() => termsAgreed && setStep("terms")}
            className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
              step === "terms" 
                ? "bg-[#5B6CFF] border-[#5B6CFF] text-white shadow-[0_0_12px_rgba(91,108,255,0.4)] scale-105" 
                : "bg-[#0b0f1a] border-[#5B6CFF]/40 text-[#bdc2ff]"
            }`}
          >
            1
          </button>

          <button
            type="button"
            onClick={() => termsAgreed && facilityLocation && primaryContact && setStep("profile")}
            disabled={!termsAgreed}
            className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
              step === "profile" 
                ? "bg-[#5B6CFF] border-[#5B6CFF] text-white shadow-[0_0_12px_rgba(91,108,255,0.4)] scale-105" 
                : step === "operations" 
                  ? "bg-[#5B6CFF]/20 border-[#5B6CFF] text-[#bdc2ff]" 
                  : "bg-[#0b0f1a] border-white/5 text-muted-foreground"
            }`}
          >
            2
          </button>

          <button
            type="button"
            disabled={!termsAgreed || !facilityLocation || !primaryContact}
            className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-xs font-bold transition-all duration-300 ${
              step === "operations" 
                ? "bg-[#22D3EE] border-[#22D3EE] text-[#062a33] shadow-[0_0_12px_rgba(34,211,238,0.4)] scale-105" 
                : "bg-[#0b0f1a] border-white/5 text-muted-foreground"
            }`}
          >
            3
          </button>
        </div>

        {/* Content Wizard */}
        <div className="space-y-6 pt-2">
          {step === "terms" && (
            <div className="space-y-5">
              <div className="h-56 overflow-y-auto rounded-xl border border-white/5 bg-[#0b0f1a]/60 p-5 text-xs leading-relaxed text-muted-foreground shadow-inner select-none space-y-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-[#f5f7ff] text-sm flex items-center gap-1.5">
                    <Shield size={14} className="text-[#5B6CFF]" />
                    <span>1. Terms & Conditions</span>
                  </h3>
                  <p className="pl-5 text-[#6c7591]">
                    Welcome to ORRN-AL. By utilizing this Software-as-a-Service system for your manufacturing operations, you agree to safeguard security tokens, respect tenant boundaries, and enforce proper role-based authorization parameters on your local spool network.
                  </p>
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-[#f5f7ff] text-sm flex items-center gap-1.5">
                    <CheckCircle size={14} className="text-[#5B6CFF]" />
                    <span>2. Data Isolation and Privacy</span>
                  </h3>
                  <p className="pl-5 text-[#6c7591]">
                    ORRN-AL enforces strict multi-tenant database isolation. Your company data, extrusion logs, packing list configurations, and spool audit events are restricted to your tenant context and never cached or synchronized cross-tenant.
                  </p>
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-[#f5f7ff] text-sm flex items-center gap-1.5">
                    <Activity size={14} className="text-[#5B6CFF]" />
                    <span>3. Spool Webhooks and Local Printing</span>
                  </h3>
                  <p className="pl-5 text-[#6c7591]">
                    Any print queuing triggers LAN `orrn-spool` integrations. Ensure that your spool API key remains wrapped and encrypted at all times to prevent malicious access to physical print operations.
                  </p>
                </div>
              </div>

              <label className="flex items-center space-x-3 cursor-pointer rounded-xl border border-[#5B6CFF]/20 bg-[#0b0f1a]/45 p-4 hover:bg-[#0b0f1a]/70 transition-colors select-none">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  className="h-4.5 w-4.5 rounded border-white/10 bg-[#0b0f1a] text-[#5B6CFF] focus:ring-[#5B6CFF] transition-all"
                />
                <span className="text-xs font-semibold text-[#a3acc4] font-sans">
                  I Agree and Consent to the terms and conditions outlined above
                </span>
              </label>

              <Button
                onClick={handleNextStep}
                className="w-full bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all hover:scale-[1.01] flex items-center justify-center gap-2"
                disabled={!termsAgreed}
              >
                <span>Proceed to Profile Setup</span>
                <ChevronRight size={16} />
              </Button>
            </div>
          )}

          {step === "profile" && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="facilityLocation" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1">
                  <MapPin size={12} />
                  <span>Facility / Plant Location</span>
                </Label>
                <Input
                  id="facilityLocation"
                  placeholder="e.g. Atlanta Press Facility, GA"
                  value={facilityLocation}
                  onChange={(e) => setFacilityLocation(e.target.value)}
                  required
                  className="bg-[#0b0f1a]/60 border-white/10 focus:border-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg w-full"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="primaryContact" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1">
                    <Phone size={12} />
                    <span>Primary Contact Number</span>
                  </Label>
                  <Input
                    id="primaryContact"
                    type="tel"
                    placeholder="+1 (555) 019-2834"
                    value={primaryContact}
                    onChange={(e) => setPrimaryContact(e.target.value)}
                    required
                    className="bg-[#0b0f1a]/60 border-white/10 focus:border-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg w-full"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="timezone" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1">
                    <Clock size={12} />
                    <span>Operational Timezone</span>
                  </Label>
                  <select
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-white/10 bg-[#0b0f1a]/60 px-3 py-2 text-sm text-[#f5f7ff] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5B6CFF] focus-visible:border-[#5B6CFF] disabled:cursor-not-allowed disabled:opacity-50 font-mono transition-all"
                  >
                    <option value="America/New_York" className="bg-[#121826]">Eastern Time (ET)</option>
                    <option value="America/Chicago" className="bg-[#121826]">Central Time (CT)</option>
                    <option value="America/Denver" className="bg-[#121826]">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles" className="bg-[#121826]">Pacific Time (PT)</option>
                    <option value="UTC" className="bg-[#121826]">Coordinated Universal Time (UTC)</option>
                  </select>
                </div>
              </div>

              <div className="flex space-x-3 pt-4 border-t border-white/5">
                <Button
                  onClick={handleBackStep}
                  className="flex-1 bg-transparent hover:bg-white/5 text-muted-foreground border border-white/10 h-10 rounded-lg font-semibold"
                >
                  Back
                </Button>
                <Button
                  onClick={handleNextStep}
                  className="flex-1 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg border border-white/5 transition-all hover:scale-[1.01]"
                  disabled={!facilityLocation || !primaryContact}
                >
                  Next: Capacity Setup
                </Button>
              </div>
            </div>
          )}

          {step === "operations" && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/15 p-4 text-xs text-[#22D3EE] leading-relaxed font-mono relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-[#22D3EE]/15 text-[#22D3EE] text-[8px] font-bold px-2 py-0.5 rounded-bl">
                  CAPACITY ENGINE
                </div>
                <strong className="block mb-1 text-cyan-300">ORRN-AL Extrusion Mode:</strong>
                Define the count of extrusion press lines available at your plant. This dictates scheduling workflows, die allocation grids, and press queue parameters dynamically.
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pressCount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1">
                  <Activity size={12} className="text-cyan-400" />
                  <span>Active Extrusion Press Lines Count</span>
                </Label>
                <Input
                  id="pressCount"
                  type="number"
                  min={1}
                  max={50}
                  value={pressCount}
                  onChange={(e) => setPressCount(parseInt(e.target.value) || 0)}
                  required
                  className="bg-[#0b0f1a]/60 border-white/10 focus:border-[#5B6CFF] text-[#f5f7ff] text-sm h-10 rounded-lg font-mono w-full"
                />
              </div>

              <div className="flex space-x-3 pt-4 border-t border-white/5">
                <Button
                  type="button"
                  onClick={handleBackStep}
                  className="flex-1 bg-transparent hover:bg-white/5 text-muted-foreground border border-white/10 h-10 rounded-lg font-semibold"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold h-10 rounded-lg shadow-lg shadow-[#5B6CFF]/20 border border-white/5 transition-all hover:scale-[1.01] flex items-center justify-center gap-2"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Completing Onboarding…</span>
                    </>
                  ) : (
                    "Complete Onboarding"
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
