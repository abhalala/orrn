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
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
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
      toastOptions={{
        classNames: {
          toast: "cn-toast font-sans shadow-md",
          title: "font-semibold break-words",
          description: "break-words",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
