/**
 * @orrn/ingest: the pure engine of the Infinity Portal (recipes, fingerprints, fit, readers, period).
 * No runtime dependency but zod and @orrn/domain. Plan: docs/superpowers/plans/2026-11-10-infinity-portal-wave1.md.
 */
export * from "./states";
export * from "./recipe";
export * from "./targets";
export * from "./units-adapter";
export { sha256Bytes, sha256Hex } from "./hash";
export * from "./recipe-fixtures";
