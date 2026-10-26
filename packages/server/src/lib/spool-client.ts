/**
 * HTTP client for calling orrn-spool instances.
 *
 * All requests are signed with the shared secret using HMAC-SHA256
 * via @orrn/server/lib/spool-crypto. The spool verifies the signature
 * to authenticate ORRN as the caller.
 */

import { signSpoolRequest } from "./spool-crypto";

/** A non-2xx answer from the spool, with its status and the body text (for `job_key_conflict` and the like). */
export class SpoolHttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(`Spool ${method} ${path} failed: ${status} ${bodyText}`);
    this.name = "SpoolHttpError";
  }

  /** The `error` code of a JSON body (`job_key_conflict`, `invalid_job_key`), or null. */
  get code(): string | null {
    try {
      const body = JSON.parse(this.bodyText) as { error?: unknown };
      return typeof body.error === "string" ? body.error : null;
    } catch {
      return null;
    }
  }
}

/** Spool API response types — mirrors the Go structs in orrn-spool. */

export interface SpoolPrinter {
  id: number;
  name: string;
  ip_address: string;
  port: number;
  dpi: number;
  label_width_mm: number;
  label_height_mm: number;
  gap_mm: number;
  status: string;
  last_seen_at: string | null;
  total_prints: number;
  created_at: string;
  updated_at: string;
}

export interface SpoolTemplate {
  id: number;
  name: string;
  description: string;
  schema_json: string;
  width_mm: number;
  height_mm: number;
  created_at: string;
  updated_at: string;
}

export interface SpoolJob {
  id: number;
  printer_id: number;
  template_id: number;
  variables_json: string;
  tspl_content: string;
  status: string;
  priority: number;
  retry_count: number;
  error_message: string;
  copies: number;
  submitted_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface SpoolJobStatus {
  id: number;
  status: string;
  error_message: string;
}

export interface SpoolPrinterStatus {
  printer_id: number;
  printer_name: string;
  previous_status: string;
  new_status: string;
  printer_state: string;
  warning: string;
  error: string;
  media_error: string;
  is_online: boolean;
}

/**
 * GET /scale/reading on orrn-spool (internal/scale). `grams` is absent when the reading is stale
 * or there are no frames; `stable` is the spool's verdict under the spec rule (five frames within
 * 20 g held 1 s, stale after 3 s, a steady 0 is not a weight).
 */
export interface SpoolScaleReading {
  grams?: number;
  stable: boolean;
  ageMs?: number;
  frames?: number;
  reason?: string;
  configured?: boolean;
  simulated?: boolean;
}

/** Default budget for a scale poll: a pack screen polls often, so fail fast. */
export const SCALE_READING_TIMEOUT_MS = 1500;

/**
 * Base URL for a node domain. Deployed nodes are reached over HTTPS through their tunnel; a
 * loopback domain (a spool running on the developer's machine, or a test's fake spool) uses
 * plain HTTP. A Worker cannot reach loopback in production, so this never downgrades a real node.
 */
export function spoolBaseUrl(nodeDomain: string): string {
  const host = nodeDomain.replace(/:\d+$/, "").toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return `${loopback ? "http" : "https"}://${nodeDomain}`;
}

export class SpoolClient {
  private baseUrl: string;
  private sharedSecret: string;

  constructor(baseUrl: string, sharedSecret: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.sharedSecret = sharedSecret;
  }

  // ─── Printers ──────────────────────────────────────────────────────────────

  async listPrinters(): Promise<SpoolPrinter[]> {
    return this.get<SpoolPrinter[]>("/api/printers");
  }

  async addPrinter(printer: {
    name: string;
    ip_address: string;
    port: number;
    dpi: number;
    label_width_mm: number;
    label_height_mm: number;
    gap_mm: number;
  }): Promise<SpoolPrinter> {
    return this.post<SpoolPrinter>("/api/printers", printer);
  }

  async getPrinterStatus(printerId: number): Promise<SpoolPrinterStatus> {
    return this.get<SpoolPrinterStatus>(`/api/printers/${printerId}/status`);
  }

  async testPrint(printerId: number): Promise<void> {
    await this.postRaw(`/api/printers/${printerId}/test`, {});
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  async listTemplates(): Promise<SpoolTemplate[]> {
    return this.get<SpoolTemplate[]>("/api/templates");
  }

  async pushTemplate(template: {
    name: string;
    description?: string;
    schema_json: string;
    width_mm: number;
    height_mm: number;
  }): Promise<SpoolTemplate> {
    return this.post<SpoolTemplate>("/api/templates", template);
  }

  async updateTemplate(
    templateId: number,
    template: {
      name?: string;
      description?: string;
      schema_json?: string;
      width_mm?: number;
      height_mm?: number;
    },
  ): Promise<SpoolTemplate> {
    return this.put<SpoolTemplate>(`/api/templates/${templateId}`, template);
  }

  // ─── Jobs ──────────────────────────────────────────────────────────────────

  async createJob(job: {
    printer_id: number;
    template_id: number;
    variables: Record<string, string>;
    copies: number;
    priority?: number;
    /**
     * Exactly-once key (orrn-spool docs/print-exactly-once.md): a repeat of the same label answers
     * `200 { duplicate: true }` with the FIRST job's id; other content under the key is `409 job_key_conflict`.
     */
    job_key?: string;
  }): Promise<{ id: number; duplicate?: boolean }> {
    return this.post<{ id: number; duplicate?: boolean }>("/api/jobs", job);
  }

  async getJobStatus(jobId: number): Promise<SpoolJobStatus> {
    return this.get<SpoolJobStatus>(`/api/jobs/${jobId}`);
  }

  async cancelJob(jobId: number): Promise<void> {
    await this.postRaw(`/api/jobs/${jobId}/cancel`, {});
  }

  async retryJob(jobId: number): Promise<void> {
    await this.postRaw(`/api/jobs/${jobId}/retry`, {});
  }

  // ─── Scale ─────────────────────────────────────────────────────────────────

  /**
   * One reading from the node's weighing scale. Throws on timeout, network error or a non-2xx
   * answer; callers turn that into `{ stable: false }`.
   */
  async scaleReading(options: { timeoutMs?: number } = {}): Promise<SpoolScaleReading> {
    return this.get<SpoolScaleReading>("/scale/reading", options.timeoutMs ?? SCALE_READING_TIMEOUT_MS);
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async health(): Promise<{ status: string; version: string }> {
    return this.get<{ status: string; version: string }>("/health");
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async get<T>(path: string, timeoutMs?: number): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await signSpoolRequest("GET", path, null, this.sharedSecret);
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) {
      throw new Error(`Spool GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const token = await signSpoolRequest("POST", path, bodyBytes, this.sharedSecret);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: bodyBytes,
    });
    if (!res.ok) {
      throw new SpoolHttpError("POST", path, res.status, await res.text());
    }
    return res.json() as Promise<T>;
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const token = await signSpoolRequest("PUT", path, bodyBytes, this.sharedSecret);
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: bodyBytes,
    });
    if (!res.ok) {
      throw new Error(`Spool PUT ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async postRaw(path: string, body: unknown): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const token = await signSpoolRequest("POST", path, bodyBytes, this.sharedSecret);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: bodyBytes,
    });
    if (!res.ok) {
      throw new Error(`Spool POST ${path} failed: ${res.status} ${await res.text()}`);
    }
  }
}