import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

type In = inferRouterInputs<AppRouter>["ingest"];
type Out = inferRouterOutputs<AppRouter>["ingest"];

/**
 * The `ingest` router as the web calls it (plan B5): one async function per procedure, typed from the router
 * itself. The upload client and the pumps take an `IngestApi` so tests can pass a fake. The real one is
 * `ingestApi()` in `trpc-api.ts` (the only file here that touches the tRPC client).
 */
export type IngestApi = {
  status: () => Promise<Out["status"]>;
  artifactBegin: (input: In["artifact"]["begin"]) => Promise<Out["artifact"]["begin"]>;
  artifactCommitRaw: (input: In["artifact"]["commitRaw"]) => Promise<Out["artifact"]["commitRaw"]>;
  artifactPutBlocks: (input: In["artifact"]["putBlocks"]) => Promise<Out["artifact"]["putBlocks"]>;
  artifactPutRows: (input: In["artifact"]["putRows"]) => Promise<Out["artifact"]["putRows"]>;
  artifactComplete: (input: In["artifact"]["complete"]) => Promise<Out["artifact"]["complete"]>;
  artifactList: (input: In["artifact"]["list"]) => Promise<Out["artifact"]["list"]>;
  artifactGet: (input: In["artifact"]["get"]) => Promise<Out["artifact"]["get"]>;
  periodConfirm: (input: In["period"]["confirm"]) => Promise<Out["period"]["confirm"]>;
  candidateList: (input: In["candidate"]["list"]) => Promise<Out["candidate"]["list"]>;
  candidateGet: (input: In["candidate"]["get"]) => Promise<Out["candidate"]["get"]>;
  candidateSetTarget: (input: In["candidate"]["setTarget"]) => Promise<Out["candidate"]["setTarget"]>;
  candidateConfirmNear: (input: In["candidate"]["confirmNear"]) => Promise<Out["candidate"]["confirmNear"]>;
  candidateApprove: (input: In["candidate"]["approve"]) => Promise<Out["candidate"]["approve"]>;
  candidateHold: (input: In["candidate"]["hold"]) => Promise<Out["candidate"]["hold"]>;
  candidateRelease: (input: In["candidate"]["release"]) => Promise<Out["candidate"]["release"]>;
  candidateRepickHeader: (input: In["candidate"]["repickHeader"]) => Promise<Out["candidate"]["repickHeader"]>;
  candidateDiscard: (input: In["candidate"]["discard"]) => Promise<Out["candidate"]["discard"]>;
  shapeMake: (input: In["shape"]["make"]) => Promise<Out["shape"]["make"]>;
  shapeSave: (input: In["shape"]["save"]) => Promise<Out["shape"]["save"]>;
  dryRunStep: (input: In["dryRun"]["step"]) => Promise<Out["dryRun"]["step"]>;
  rowsList: (input: In["rows"]["list"]) => Promise<Out["rows"]["list"]>;
  rowsSkipNoDate: (input: In["rows"]["skipNoDate"]) => Promise<Out["rows"]["skipNoDate"]>;
  rowsDecide: (input: In["rows"]["decide"]) => Promise<Out["rows"]["decide"]>;
  answerSet: (input: In["answer"]["set"]) => Promise<Out["answer"]["set"]>;
  mergeStart: () => Promise<Out["merge"]["start"]>;
  mergeStep: (input: In["merge"]["step"]) => Promise<Out["merge"]["step"]>;
  mergeGet: (input: In["merge"]["get"]) => Promise<Out["merge"]["get"]>;
  mergeStop: (input: In["merge"]["stop"]) => Promise<Out["merge"]["stop"]>;
  holeList: (input: In["hole"]["list"]) => Promise<Out["hole"]["list"]>;
  holeRetire: (input: In["hole"]["retire"]) => Promise<Out["hole"]["retire"]>;
  provenanceForRecord: (input: In["provenance"]["forRecord"]) => Promise<Out["provenance"]["forRecord"]>;
};

export type { In as IngestInputs, Out as IngestOutputs };
