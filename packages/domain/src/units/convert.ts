/**
 * Exact conversion between stored integers and unit amounts. Integer and BigInt maths only.
 * Half away from zero, applied once, at the very end.
 */
import {
  addRatio, divRatio, mulDivRoundNumber, mulRatio, ratio, roundHalfAway, subRatio,
  type Ratio,
} from "./rational";
import { factorBetween, UNITS, type UnitDef, type UnitId } from "./registry";

function def(id: UnitId): UnitDef {
  const u = (UNITS as Record<string, UnitDef | undefined>)[id];
  if (!u) throw new RangeError(`unknown unit: ${String(id)}`);
  return u;
}

function sameKind(a: UnitId, b: UnitId): void {
  if (def(a).kind !== def(b).kind) throw new RangeError(`unit kind mismatch: ${a} is ${def(a).kind}, ${b} is ${def(b).kind}`);
}

const hasOffset = (u: UnitDef) => u.offNum !== undefined;
const offset = (u: UnitDef): Ratio => (u.offNum === undefined ? ratio(0n) : ratio(u.offNum, u.offDen ?? 1n));

/** `amount` of `unit`, as an exact number of base units of its kind. */
export function toBase(amount: Ratio, unit: UnitId): Ratio {
  const u = def(unit);
  return addRatio(mulRatio(amount, ratio(u.num, u.den)), offset(u));
}

/** The exact amount of `unit` that `base` base units make. */
export function fromBase(base: Ratio, unit: UnitId): Ratio {
  const u = def(unit);
  return divRatio(subRatio(base, offset(u)), ratio(u.num, u.den));
}

export type StorageResult = {
  /** The whole number to store. May be unsafe: callers that store it must check. */
  big: bigint;
  exact: boolean;
  /** exact value minus stored value, in storage units */
  residue: Ratio;
};

/** The exact rational path. Used by `toStorage` and by `toCanonical`, which wants the bigint and the residue. */
export function toStorageBig(amount: Ratio, unit: UnitId, storage: UnitId): StorageResult {
  sameKind(unit, storage);
  const inStorage = fromBase(toBase(amount, unit), storage);
  const big = roundHalfAway(inStorage.num, inStorage.den);
  const residue = subRatio(inStorage, ratio(big));
  return { big, exact: residue.num === 0n, residue };
}

export function toStorage(
  amount: Ratio,
  unit: UnitId,
  storage: UnitId,
): { value: number; exact: boolean; residue: Ratio } {
  const r = toStorageBig(amount, unit, storage);
  const value = Number(r.big);
  if (!Number.isSafeInteger(value)) throw new RangeError("toStorage: result is beyond the safe integer range");
  return { value, exact: r.exact, residue: r.residue };
}

/** A stored integer as an exact amount of `unit`. */
export function fromStorage(value: number, storage: UnitId, unit: UnitId): Ratio {
  sameKind(storage, unit);
  if (!Number.isSafeInteger(value)) throw new RangeError(`fromStorage: ${value} is not a safe integer`);
  return fromBase(toBase(ratio(BigInt(value)), storage), unit);
}

/**
 * A stored integer in another unit's own whole steps, rounded half away from zero.
 * `value` is in `from`; the answer is in `to`. Number path while every product is a safe integer, BigInt otherwise.
 */
export function convertStorage(value: number, from: UnitId, to: UnitId): { value: number; exact: boolean } {
  sameKind(from, to);
  if (!Number.isSafeInteger(value)) throw new RangeError(`convertStorage: ${value} is not a safe integer`);
  const a = def(from);
  const b = def(to);
  if (!hasOffset(a) && !hasOffset(b)) {
    const f = factorBetween(from, to);
    const n = Number(f.num);
    const d = Number(f.den);
    if (Number.isSafeInteger(n) && Number.isSafeInteger(d)) {
      const fast = mulDivRoundNumber(value, n, d);
      if (fast !== null) return { value: fast, exact: (value * n) % d === 0 };
    }
  }
  const r = toStorageBig(ratio(BigInt(value)), from, to);
  const out = Number(r.big);
  if (!Number.isSafeInteger(out)) throw new RangeError("convertStorage: result is beyond the safe integer range");
  return { value: out, exact: r.exact };
}

/** The slow path, kept public so tests can hold the fast path against it. */
export function convertStorageBig(value: number, from: UnitId, to: UnitId): { value: number; exact: boolean } {
  sameKind(from, to);
  const r = toStorageBig(ratio(BigInt(value)), from, to);
  return { value: Number(r.big), exact: r.exact };
}
