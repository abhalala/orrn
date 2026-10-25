import type { MessageKey } from "@orrn/i18n";

import { noReply } from "@/lib/replay-key";

/**
 * Why a label did not print, in plain words (the server's messages name the print service, which the screen
 * never does). Same classes as the web: the node is not set up, no printer, no template, the printer did not
 * take it, no permission, no connection.
 */
export type PrintErrorKey =
  | "pack.print.errors.notSetUp"
  | "pack.print.errors.noPrinter"
  | "pack.print.errors.noTemplate"
  | "pack.print.errors.offline"
  | "pack.print.errors.forbidden"
  | "pack.print.errors.network"
  | "pack.print.errors.generic";

export function printErrorKey(error: unknown): PrintErrorKey {
  if (!error || typeof error !== "object") return "pack.print.errors.generic";
  const data = (error as { data?: { code?: string } | null }).data;
  if (!data) return "pack.print.errors.network";
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  if (data.code === "FORBIDDEN") return "pack.print.errors.forbidden";
  if (data.code === "NOT_FOUND" && message.includes("deployment")) return "pack.print.errors.notSetUp";
  if (data.code === "NOT_FOUND" && message.includes("printer")) return "pack.print.errors.noPrinter";
  if (data.code === "BAD_REQUEST" && message.includes("template")) return "pack.print.errors.noTemplate";
  if (data.code === "BAD_GATEWAY") return "pack.print.errors.offline";
  return noReply(error) ? "pack.print.errors.network" : "pack.print.errors.generic";
}

/** A bundle that can have its label printed again: any bundle that is not void. */
export function canReprint(status: string): boolean {
  return status !== "void";
}

export const REPRINT_KEYS: readonly MessageKey[] = ["bundle.reprint", "pack.detail.labelSent", "pack.print.errors.notSetUp", "pack.print.errors.noPrinter", "pack.print.errors.noTemplate", "pack.print.errors.offline", "pack.print.errors.forbidden", "pack.print.errors.network", "pack.print.errors.generic"];
