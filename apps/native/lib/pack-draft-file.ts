import * as FileSystem from "expo-file-system/legacy";

import { parseDraft, serializeDraft, type PackDraft } from "@/features/pack/draft-store";

/**
 * The unsaved packing session lives in one small file in the app's document
 * folder, so an OS kill mid-session (a call, the camera) does not lose typed
 * bundles. (De)serialisation and the owner check are pure, in
 * features/pack/draft-store.ts. Every call fails quietly: a missing draft is
 * the normal case and a write that fails must never block packing.
 */
const FILE = "pack-draft.json";

function uri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${FILE}` : null;
}

/** The stored draft if it belongs to `owner` and is valid; else null. */
export async function readPackDraft(owner: string): Promise<PackDraft | null> {
  const target = uri();
  if (!target) return null;
  try {
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) return null;
    return parseDraft(await FileSystem.readAsStringAsync(target), owner);
  } catch {
    return null;
  }
}

export async function writePackDraft(draft: PackDraft): Promise<void> {
  const target = uri();
  if (!target) return;
  try {
    await FileSystem.writeAsStringAsync(target, serializeDraft(draft));
  } catch {
    // Keep packing; the next change writes again.
  }
}

export async function clearPackDraft(): Promise<void> {
  const target = uri();
  if (!target) return;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
  } catch {
    // Nothing to remove.
  }
}
