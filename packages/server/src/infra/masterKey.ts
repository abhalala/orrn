import { isUnsafeMasterKey, PUBLIC_DEV_MASTER_KEY } from "@orrn/crypto";

/**
 * The ORRN_MASTER_KEY a deploy binds (security review 2026-11-04, MEDIUM 4). It signs die-file and
 * download URLs and wraps every node secret, so outside the dev stage a missing key or the public
 * all-zero dev key stops the deploy instead of shipping a key anyone with the source knows. The
 * dev stage may still fall back to the dev key. Tested in test/infra-master-key.test.ts.
 */
export function deployMasterKey(opts: { isDevStage: boolean; value: string | undefined }): string {
  const value = opts.value?.trim() ?? "";
  if (opts.isDevStage) return value || PUBLIC_DEV_MASTER_KEY;
  if (isUnsafeMasterKey(value)) {
    throw new Error(
      "ORRN_MASTER_KEY is required outside the dev stage and must not be the public all-zero dev key: it signs file and download links and wraps node secrets.",
    );
  }
  return value;
}
