/**
 * Exact rational maths for the units layer. Integers and BigInt only, never a float.
 * A Ratio is always reduced with a positive denominator.
 */

export type Ratio = { num: bigint; den: bigint };

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function ratio(num: bigint, den: bigint = 1n): Ratio {
  if (den === 0n) throw new RangeError("ratio: zero denominator");
  const g = gcd(num, den) || 1n;
  const sign = den < 0n ? -1n : 1n;
  return { num: (sign * num) / g, den: (sign * den) / g };
}

export function mulRatio(a: Ratio, b: Ratio): Ratio {
  return ratio(a.num * b.num, a.den * b.den);
}

export function divRatio(a: Ratio, b: Ratio): Ratio {
  return ratio(a.num * b.den, a.den * b.num);
}

export function addRatio(a: Ratio, b: Ratio): Ratio {
  return ratio(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function subRatio(a: Ratio, b: Ratio): Ratio {
  return ratio(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function cmpRatio(a: Ratio, b: Ratio): number {
  const d = a.num * b.den - b.num * a.den;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

const POW10_CACHE: bigint[] = [1n];
export function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`pow10: bad exponent ${n}`);
  while (POW10_CACHE.length <= n) POW10_CACHE.push(POW10_CACHE[POW10_CACHE.length - 1]! * 10n);
  return POW10_CACHE[n]!;
}

/** Round `num / den` to a whole number, halves away from zero. The one rounding step of every conversion. */
export function roundHalfAway(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("roundHalfAway: zero denominator");
  if (den < 0n) return roundHalfAway(-num, -den);
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = (2n * a + den) / (2n * den);
  return neg ? -q : q;
}

/** Number fast path for `value * n / d` rounded half away from zero. Null when a product leaves the safe range. */
export function mulDivRoundNumber(value: number, n: number, d: number): number | null {
  const p = value * n;
  if (!Number.isSafeInteger(p) || !Number.isSafeInteger(d) || d <= 0) return null;
  const neg = p < 0;
  const a = neg ? -p : p;
  const twice = 2 * a + d;
  if (!Number.isSafeInteger(twice)) return null;
  const r = twice % (2 * d);
  const q = (twice - r) / (2 * d);
  return neg && q !== 0 ? -q : q;
}

export function ratioIsInteger(r: Ratio): boolean {
  return r.den === 1n;
}

/** "1/3", "-5/2", or "4" for whole values. */
export function ratioToString(r: Ratio): string {
  return r.den === 1n ? r.num.toString() : `${r.num}/${r.den}`;
}

/** True when `r` is a whole multiple of `step`. */
export function isMultipleOf(r: Ratio, step: Ratio): boolean {
  const q = divRatio(r, step);
  return q.den === 1n;
}
