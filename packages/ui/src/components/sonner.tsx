"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[18px]" strokeWidth={2} aria-hidden="true" />,
        info: <InfoIcon className="size-[18px]" strokeWidth={2} aria-hidden="true" />,
        warning: <TriangleAlertIcon className="size-[18px]" strokeWidth={2} aria-hidden="true" />,
        error: <OctagonXIcon className="size-[18px]" strokeWidth={2} aria-hidden="true" />,
        loading: <Loader2Icon className="size-[18px] animate-spin" strokeWidth={2} aria-hidden="true" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "16px",
          // `richColors` toasts use the C2 chip pairs (>= 4.5:1 both themes).
          "--success-bg": "var(--tone-green-tint)",
          "--success-text": "var(--tone-green-ink)",
          "--success-border": "color-mix(in srgb, var(--tone-green-ink) 22%, transparent)",
          "--info-bg": "var(--tone-blue-tint)",
          "--info-text": "var(--tone-blue-ink)",
          "--info-border": "color-mix(in srgb, var(--tone-blue-ink) 22%, transparent)",
          "--warning-bg": "var(--tone-amber-tint)",
          "--warning-text": "var(--tone-amber-ink)",
          "--warning-border": "color-mix(in srgb, var(--tone-amber-ink) 22%, transparent)",
          "--error-bg": "var(--tone-red-tint)",
          "--error-text": "var(--tone-red-ink)",
          "--error-border": "color-mix(in srgb, var(--tone-red-ink) 22%, transparent)",
        } as React.CSSProperties
      }
      // Toasts never take focus; sonner announces them in a polite live region.
      toastOptions={{
        classNames: {
          toast: "cn-toast !rounded-card font-sans !text-[15px] shadow-md !gap-3 !px-4 !py-3.5",
          title: "!font-semibold leading-snug",
          description: "!text-[14px] leading-snug",
          actionButton: "!rounded-full !font-semibold !h-9 !px-3.5",
          cancelButton: "!rounded-full !font-semibold !h-9 !px-3.5",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
