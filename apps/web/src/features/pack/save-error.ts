import { isConnectionError } from "./print-labels";

/**
 * What a failed `bundle.createReceipt` means for the packer:
 * - `forbidden`: their role cannot pack.
 * - `yard`: the chosen yard was retired or removed since the yards loaded.
 * - `unsure`: orrn never answered (connection dropped) or a server/gateway
 *   failed (5xx). The session may have saved: check the Pack list before
 *   trying again, or a retry packs every bundle twice.
 * - `failed`: orrn refused it; nothing was saved.
 */
export type SaveErrorKind = "forbidden" | "yard" | "unsure" | "failed";

export function saveErrorKind(error: unknown): SaveErrorKind {
  if (isConnectionError(error)) return "unsure";
  const e = (error && typeof error === "object" ? error : {}) as {
    data?: { code?: string; httpStatus?: number } | null;
    message?: unknown;
  };
  const code = e.data?.code;
  const status = e.data?.httpStatus;
  if (!code || (typeof status === "number" && status >= 500)) return "unsure";
  if (code === "FORBIDDEN") return "forbidden";
  const message = typeof e.message === "string" ? e.message : "";
  if ((code === "BAD_REQUEST" || code === "NOT_FOUND") && /\b(yard|location)/i.test(message)) return "yard";
  return "failed";
}
