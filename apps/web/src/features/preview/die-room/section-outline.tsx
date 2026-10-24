import { cn } from "@orrn/ui/lib/utils";

/** A drawn hollow section. Not a photograph of a die. */
export function SectionOutline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 96" className={cn("h-28 w-full text-foreground", className)} aria-hidden="true">
      <rect x="16" y="18" width="128" height="60" rx="8" fill="none" stroke="currentColor" strokeWidth="10" />
      <rect x="42" y="34" width="76" height="28" rx="3" fill="var(--surface-sunken)" stroke="currentColor" strokeWidth="4" />
      <path d="M78 18v-8h8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
