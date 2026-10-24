/**
 * Pure model for Godseye > App builds (FP-PF-11): the publish form's checks, which mirror the
 * server's (`platform.release.publish`), and the mapping of a refusal to a translated message.
 */
import { MAX_RELEASE_NOTES, RELEASE_CHANNELS, RELEASE_PLATFORMS, type ReleaseChannel, type ReleasePlatform } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { errorCode } from "./error-code";

export { MAX_RELEASE_NOTES, RELEASE_CHANNELS, RELEASE_PLATFORMS };

export type ReleaseForm = {
  platform: ReleasePlatform;
  channel: ReleaseChannel;
  version: string;
  build: string;
  minBuild: string;
  mandatory: boolean;
  notes: string;
  apkUrl: string;
};

export const EMPTY_RELEASE_FORM: ReleaseForm = {
  platform: "android",
  channel: "floor",
  version: "",
  build: "",
  minBuild: "",
  mandatory: false,
  notes: "",
  apkUrl: "",
};

export type ReleaseField = "version" | "build" | "minBuild" | "notes" | "apkUrl";

export type ReleaseInput = {
  platform: ReleasePlatform;
  channel: ReleaseChannel;
  version: string;
  buildNumber: number;
  minBuild: number;
  mandatory: boolean;
  notes: string;
  apkUrl?: string;
};

const WHOLE = /^\d{1,10}$/;

/** A published download link is for the Android floor build only. */
export function apkAllowed(form: Pick<ReleaseForm, "platform" | "channel">): boolean {
  return form.platform === "android" && form.channel === "floor";
}

/**
 * The form to the server's input, or the message key for each field that is wrong. The minimum
 * build defaults to the build number when left blank (the usual case: the new build is the floor).
 */
export function parseReleaseForm(form: ReleaseForm): { ok: true; input: ReleaseInput } | { ok: false; errors: Partial<Record<ReleaseField, MessageKey>> } {
  const errors: Partial<Record<ReleaseField, MessageKey>> = {};
  const version = form.version.trim();
  if (!version || version.length > 32) errors.version = "admin.releases.errors.generic";
  const build = form.build.trim();
  if (!WHOLE.test(build) || Number(build) < 1) errors.build = "admin.releases.errors.generic";
  const minRaw = form.minBuild.trim();
  if (minRaw !== "" && !WHOLE.test(minRaw)) errors.minBuild = "admin.releases.errors.generic";
  const buildNumber = Number(build);
  const minBuild = minRaw === "" ? buildNumber : Number(minRaw);
  if (!errors.build && !errors.minBuild && minBuild > buildNumber) errors.minBuild = "admin.releases.errors.minAbove";
  const notes = form.notes.trim();
  if (!notes || notes.length > MAX_RELEASE_NOTES) errors.notes = "admin.releases.errors.generic";
  const apk = form.apkUrl.trim();
  if (apk && !apkAllowed(form)) errors.apkUrl = "admin.releases.errors.android";
  if (apk && !/^https?:\/\/\S+$/i.test(apk)) errors.apkUrl = "admin.releases.errors.generic";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      platform: form.platform,
      channel: form.channel,
      version,
      buildNumber,
      minBuild,
      mandatory: form.mandatory,
      notes,
      ...(apk ? { apkUrl: apk } : {}),
    },
  };
}

/** A publish refusal in the screen's own words. The server's text is English and technical. */
export function releaseErrorKey(error: unknown): MessageKey {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (code === "CONFLICT") return "admin.releases.errors.exists";
  if (code === "BAD_REQUEST") {
    if (/minimum build/i.test(message)) return "admin.releases.errors.minAbove";
    if (/not above the last published/i.test(message)) return "admin.releases.errors.notAbove";
    if (/android only/i.test(message)) return "admin.releases.errors.android";
  }
  return "admin.releases.errors.generic";
}
