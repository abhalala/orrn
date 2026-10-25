import { isConnectionError } from "./print-labels";

/**
 * What a failed `bundle.createReceipt` means for the packer:
 * - `forbidden`: their role cannot pack.
 * - `yard`: the chosen yard was retired or removed since the yards loaded.
 * - `unsure`: orrn never answered (connection dropped) or a server/gateway
 *   failed (5xx). The session may have saved: check the Pack list before
 *   trying again, or a retry packs every bundle twice.
 * - `owned`: the die belongs to a customer (FP-PK-10); `ownerName` names them.
 * - `cast` / `copy`: the Source step needed a cast or a die copy.
 * - `reason`: a typed weight with a scale connected needs a reason; `scale`: no scale is connected any
 *   more, so a scale weight is refused.
 * - `order`: the order line was closed or is of another section.
 * - `trolley` (W3-AG-W): the trolley line the pieces come from was refused (not released, fewer pieces left, a different cast, or one is required).
 * - `failed`: orrn refused it; nothing was saved.
 */
export type SaveErrorKind = "forbidden" | "yard" | "unsure" | "owned" | "cast" | "copy" | "reason" | "scale" | "order" | "trolley" | "failed";

export function saveErrorKind(error: unknown): SaveErrorKind {
  if (isConnectionError(error)) return "unsure";
  const e = (error && typeof error === "object" ? error : {}) as {
    data?: { code?: string; httpStatus?: number } | null;
    message?: unknown;
  };
  const code = e.data?.code;
  const status = e.data?.httpStatus;
  if (!code || (typeof status === "number" && status >= 500)) return "unsure";
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "FORBIDDEN") return /^This die belongs to/i.test(message) ? "owned" : "forbidden";
  if (code === "BAD_REQUEST" || code === "NOT_FOUND") {
    if (/^Pick the cast|^Cast .* has no melt|^Cast not found/i.test(message)) return "cast";
    if (/^Pick the die copy|^This section has no copies/i.test(message)) return "copy";
    if (/say why the weight was typed/i.test(message)) return "reason";
    if (/no scale is connected|a scale weight must be/i.test(message)) return "scale";
    if (/trolley line|packs aged metal from a trolley/i.test(message)) return "trolley";
    if (/pick an open order|another section|Order line not found/i.test(message)) return "order";
  }
  if ((code === "BAD_REQUEST" || code === "NOT_FOUND") && /\b(yard|location)/i.test(message)) return "yard";
  return "failed";
}

/** The owner named in "This die belongs to {name}", for the notice. */
export function ownerNameOf(error: unknown): string | null {
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  const m = typeof message === "string" ? /^This die belongs to (.+)$/i.exec(message) : null;
  return m?.[1] && !/^another customer$/i.test(m[1]) ? m[1] : null;
}
