/**
 * Server messages a client tells apart (a tRPC error carries only a code and a message). They live
 * here, imported by both sides, so rewording one on the server cannot silently drop a screen into
 * its generic branch.
 */

/** die.create / die.update CONFLICT: a soft-deleted die still holds this series and code (audit S16). */
export const DELETED_DIE_CODE_MESSAGE = "A deleted die uses this code";
