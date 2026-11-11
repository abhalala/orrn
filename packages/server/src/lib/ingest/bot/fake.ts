/**
 * A scripted client for tests. Each call takes the next scripted response, or throws the
 * scripted error. It records every request so a test can read the prompt that was sent.
 * It never touches the network.
 */
import type { ShapeModelClient, ShapeRequest, ShapeResponse } from "./client";
import { ShapeClientError } from "./client";

export type FakeStep = ShapeResponse | Error;

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export class FakeShapeClient implements ShapeModelClient {
  readonly calls: ShapeRequest[] = [];
  private index = 0;

  constructor(private readonly script: FakeStep[]) {}

  get remaining(): number {
    return this.script.length - this.index;
  }

  async call(req: ShapeRequest): Promise<ShapeResponse> {
    this.calls.push(req);
    const step = this.script[this.index++];
    if (step === undefined) throw new ShapeClientError("unknown", "The fake client ran out of scripted responses.");
    if (step instanceof Error) throw step;
    return step;
  }
}

/** A response that carries the given JSON, with modest usage. Override any field. */
export function fakeResponse(json: unknown, over: Partial<ShapeResponse> = {}): ShapeResponse {
  return {
    stopReason: "end_turn",
    json,
    modelUsed: "claude-haiku-5-5",
    usage: { input: 8_000, output: 1_500, cacheRead: 6_000, cacheWrite: 0 },
    ms: 1_200,
    ...over,
  };
}

/** A refusal: the model declined and sent no JSON. */
export function fakeRefusal(over: Partial<ShapeResponse> = {}): ShapeResponse {
  return { stopReason: "refusal", json: null, modelUsed: "claude-haiku-5-5", usage: { ...ZERO_USAGE, input: 8_000 }, ms: 400, ...over };
}
