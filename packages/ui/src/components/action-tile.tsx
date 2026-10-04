import type { StatusTone } from "@orrn/domain";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { PALETTE_CLASSES } from "./badge";
import { UiLink } from "./link";

export type ActionTileProps = {
  /** A status tone, or `ink` for the black block. `neutral` is the quiet white tile. */
  tone: StatusTone | "ink";
  title: string;
  hint?: string;
  /** Decorative; the title is the accessible name. */
  icon: ReactNode;
  to: string;
  /**
   * Quiet (`neutral`) tiles only: tints the icon well with an area colour
   * (Today: Pack blue, Dispatch red, Stock amber, Guides ink) so the tile
   * keeps its area colour while a screen's loud element is elsewhere.
   */
  accent?: Exclude<StatusTone, "neutral"> | "ink";
  className?: string;
  style?: CSSProperties;
};

const TONE_CLASS: Record<ActionTileProps["tone"], string> = {
  ink: "orrn-block orrn-block-neutral",
  green: "orrn-block orrn-block-green",
  blue: "orrn-block orrn-block-blue",
  amber: "orrn-block orrn-block-amber",
  red: "orrn-block orrn-block-red",
  neutral: "rounded-block border border-border bg-card text-card-foreground shadow-sm",
};

const ICON_WELL: Record<ActionTileProps["tone"], string> = {
  ink: "bg-white/14",
  green: "bg-white/18",
  blue: "bg-white/18",
  amber: "bg-black/8",
  red: "bg-white/18",
  neutral: "bg-surface-sunken",
};

/** Icon wells for quiet tiles that keep an area colour (`accent`): the chip tint/ink pairs. */
const ACCENT_WELL: Record<NonNullable<ActionTileProps["accent"]>, string> = {
  ink: "bg-foreground text-background",
  green: PALETTE_CLASSES.green,
  blue: PALETTE_CLASSES.blue,
  amber: PALETTE_CLASSES.amber,
  red: PALETTE_CLASSES.red,
};

/**
 * Primary navigation tile (Today: Pack, Scan, Stock, Dispatch). A link with
 * an icon well, a display title and an optional one-line hint. Content sits
 * at the top, so in a row of tiles stretched to one height the titles line up
 * even when one hint wraps to two lines.
 */
export function ActionTile({ tone, title, hint, icon, to, accent, className, style }: ActionTileProps) {
  return (
    <UiLink
      to={to}
      data-slot="action-tile"
      data-tone={tone}
      style={style}
      className={cn(
        TONE_CLASS[tone],
        "animate-press relative flex min-h-[128px] min-w-0 flex-col justify-start gap-4 p-4 no-underline transition-[filter,scale,background-color] duration-[var(--dur-fast)] hover:brightness-[1.04] sm:p-5",
        tone === "neutral" && "hover:brightness-100 hover:bg-surface-sunken/60",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-11 items-center justify-center rounded-full [&_svg]:size-[22px] [&_svg]:stroke-2",
          tone === "neutral" && accent ? ACCENT_WELL[accent] : ICON_WELL[tone],
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-[19px] font-bold leading-tight tracking-[-0.02em] break-words">
          {title}
        </span>
        {hint ? (
          <span
            className={cn("text-[13px] font-medium leading-snug break-words", tone === "neutral" && "text-muted-foreground")}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </UiLink>
  );
}
