import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { requireSession } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

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
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8 rounded-2xl border border-border/40 bg-[#121826]/75 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300">
        
        {/* Header */}
        <div className="space-y-2 text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-[#22D3EE]">
            ORRN-AL Plant Initialization
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff]">
            {step === "terms" && "Terms of Service"}
            {step === "profile" && "Facility Profile Setup"}
            {step === "operations" && "Extrusion Plant Parameters"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === "terms" && "Review the licensing agreement for multi-company manufactured operations."}
            {step === "profile" && "Provide baseline geographical and contact details for this plant."}
            {step === "operations" && "Configure operational capacities specific to your aluminum extrusion presses."}
          </p>
        </div>

        {/* Multi-step progress navigation bar */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => termsAgreed && setStep("terms")}
            className={`h-2 rounded-full text-left font-semibold text-xs transition-all ${
              step === "terms" ? "bg-[#5B6CFF]" : "bg-[#5B6CFF]/30"
            }`}
          />
          <button
            type="button"
            onClick={() => termsAgreed && facilityLocation && primaryContact && setStep("profile")}
            disabled={!termsAgreed}
            className={`h-2 rounded-full text-left font-semibold text-xs transition-all ${
              step === "profile" ? "bg-[#5B6CFF]" : step === "operations" ? "bg-[#5B6CFF]/50" : "bg-muted/20"
            }`}
          />
          <button
            type="button"
            disabled={!termsAgreed || !facilityLocation || !primaryContact}
            className={`h-2 rounded-full text-left font-semibold text-xs transition-all ${
              step === "operations" ? "bg-[#5B6CFF]" : "bg-muted/20"
            }`}
          />
        </div>

        {/* Content Wizard */}
        <div className="space-y-6">
          {step === "terms" && (
            <div className="space-y-5">
              <div className="h-48 overflow-y-auto rounded-lg border border-border/30 bg-[#0B0F1A]/60 p-4 text-xs leading-relaxed text-muted-foreground shadow-inner select-none">
                <h3 className="mb-2 font-bold text-[#f5f7ff]">1. Terms & Conditions</h3>
                <p className="mb-4">
                  Welcome to ORRN-AL. By utilizing this Software-as-a-Service system for your manufacturing operations, you agree to safeguard security tokens, respect tenant boundaries, and enforce proper role-based authorization parameters on your local spool network.
                </p>
                <h3 className="mb-2 font-bold text-[#f5f7ff]">2. Data Isolation and Privacy</h3>
                <p className="mb-4">
                  ORRN enforces logical multi-tenant database isolation. Your company data, extrusion logs, packing list configurations, and spool audit events are restricted to your tenant context and never cached across tenants.
                </p>
                <h3 className="mb-2 font-bold text-[#f5f7ff]">3. Spool Webhooks and Local Printing</h3>
                <p>
                  Any print queuing triggers LAN `orrn-spool` integrations. Ensure that your spool API key remains wrapped and encrypted at all times to prevent malicious access to physical print operations.
                </p>
              </div>

              <label className="flex items-center space-x-3 cursor-pointer rounded-lg border border-border/20 bg-[#0b0f1a]/30 p-4 hover:bg-[#0b0f1a]/50 transition">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-[#5B6CFF] focus:ring-[#5B6CFF]"
                />
                <span className="text-sm font-medium text-muted-foreground selection:bg-transparent">
                  I Agree and Consent to the terms and conditions outlined above
                </span>
              </label>

              <Button
                onClick={handleNextStep}
                className="w-full bg-[#5B6CFF] hover:bg-[#3b4edd] text-[#ffffff] shadow-[0_0_15px_rgba(91,108,255,0.3)] transition-all"
                disabled={!termsAgreed}
              >
                Proceed to Profile Setup
              </Button>
            </div>
          )}

          {step === "profile" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="facilityLocation">Facility / Plant Location</Label>
                <Input
                  id="facilityLocation"
                  placeholder="e.g. Atlanta Press Facility, GA"
                  value={facilityLocation}
                  onChange={(e) => setFacilityLocation(e.target.value)}
                  required
                  className="bg-[#0b0f1a]/50 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF]"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="primaryContact">Primary Contact Number</Label>
                  <Input
                    id="primaryContact"
                    type="tel"
                    placeholder="+1 (555) 019-2834"
                    value={primaryContact}
                    onChange={(e) => setPrimaryContact(e.target.value)}
                    required
                    className="bg-[#0b0f1a]/50 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Operational Timezone</Label>
                  <select
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input border-border/40 bg-[#0b0f1a]/50 px-3 py-2 text-sm text-[#f5f7ff] ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5B6CFF] focus-visible:border-[#5B6CFF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="UTC">Coordinated Universal Time (UTC)</option>
                  </select>
                </div>
              </div>

              <div className="flex space-x-3">
                <Button
                  onClick={handleBackStep}
                  className="flex-1 bg-transparent hover:bg-muted/10 text-muted-foreground border border-border/40"
                >
                  Back
                </Button>
                <Button
                  onClick={handleNextStep}
                  className="flex-1 bg-[#5B6CFF] hover:bg-[#3b4edd] text-[#ffffff]"
                  disabled={!facilityLocation || !primaryContact}
                >
                  Next: Capacity Setup
                </Button>
              </div>
            </div>
          )}

          {step === "operations" && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-4 text-sm text-[#22D3EE] leading-relaxed">
                <strong className="block mb-1 text-cyan-300">ORRN-AL Extrusion Mode:</strong>
                Define the count of extrusion press lines available at your plant. This dictates scheduling workflows, die allocation grids, and press queue parameters dynamically.
              </div>

              <div className="space-y-2">
                <Label htmlFor="pressCount">Active Extrusion Press Lines Count</Label>
                <Input
                  id="pressCount"
                  type="number"
                  min={1}
                  max={50}
                  value={pressCount}
                  onChange={(e) => setPressCount(parseInt(e.target.value) || 0)}
                  required
                  className="bg-[#0b0f1a]/50 focus:border-[#5B6CFF] focus:ring-1 focus:ring-[#5B6CFF]"
                />
              </div>

              <div className="flex space-x-3">
                <Button
                  type="button"
                  onClick={handleBackStep}
                  className="flex-1 bg-transparent hover:bg-muted/10 text-muted-foreground border border-border/40"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-[#5B6CFF] hover:bg-[#3b4edd] text-[#ffffff] shadow-[0_0_15px_rgba(91,108,255,0.3)] transition-all"
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
