/**
 * Minimal ambient types for `bun:test`. `bun-types` is not an allowed
 * dependency (see constraints), so only the surface the server tests use is
 * declared. Matchers are intentionally loose (`any`).
 */
declare module "bun:test" {
  type Fn = () => void | Promise<void>;
  export function test(name: string, fn: Fn, timeout?: number): void;
  export namespace test {
    function skip(name: string, fn: Fn): void;
    function todo(name: string, fn?: Fn): void;
    function only(name: string, fn: Fn, timeout?: number): void;
    function each<T>(rows: readonly T[]): (name: string, fn: (row: T) => void | Promise<void>) => void;
  }
  export const it: typeof test;
  export function describe(name: string, fn: () => void): void;
  export function beforeAll(fn: Fn): void;
  export function afterAll(fn: Fn): void;
  export function beforeEach(fn: Fn): void;
  export function afterEach(fn: Fn): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function expect(value: unknown): any;
  export namespace expect {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function objectContaining(obj: Record<string, unknown>): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function any(ctor: unknown): any;
  }
  export const mock: {
    module(specifier: string, factory: () => Record<string, unknown>): void;
    <T extends (...args: never[]) => unknown>(fn?: T): T;
  };
}
