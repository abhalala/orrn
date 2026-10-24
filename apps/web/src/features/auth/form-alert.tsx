import { cn } from "@orrn/ui/lib/utils";
import { AlertCircle, Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Inline message under a front-door form: red for what went wrong (with how
 * to fix it), blue for a neutral heads-up. Red is announced assertively
 * (`role="alert"`) because it blocks the person; blue politely. Text sits on
 * the tone's soft tint with its ink colour (>= 4.5:1 in both themes).
 */
export function FormAlert({
  tone = "red",
  children,
  className,
  id,
}: {
  tone?: "red" | "blue";
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const Icon = tone === "red" ? AlertCircle : Info;
  return (
    <div
      id={id}
      role={tone === "red" ? "alert" : "status"}
      data-tone={tone}
      className={cn(
        "flex items-start gap-2.5 rounded-input px-3.5 py-3 text-[14px] font-medium leading-5",
        tone === "red" ? "bg-tone-red-tint text-tone-red-ink" : "bg-tone-blue-tint text-tone-blue-ink",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-px size-[18px] shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}
