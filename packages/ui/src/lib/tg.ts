/**
 * Typed re-export of Tamagui primitives used by ORRN shared components.
 *
 * Why: Tamagui's strict types collide with TypeScript 6's stricter index
 * signature handling, producing dozens of "Property X is incompatible with
 * index signature" errors on plain numeric/string style props that are
 * perfectly valid at runtime. Tamagui upstream tracks this; until they ship a
 * fix we relax the typing on the components we use most so our shared UI
 * compiles cleanly while keeping the runtime behaviour identical.
 *
 * Consumers outside `packages/ui` should still import from "tamagui"
 * directly (they typically use looser tsconfig settings inherited from the
 * web/native apps and don't trip the same errors).
 */
import * as Tg from "tamagui";
import type { ComponentType, ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyComp = ComponentType<AnyProps> & { [key: string]: any };

export const Stack = Tg.Stack as unknown as AnyComp;
export const XStack = Tg.XStack as unknown as AnyComp;
export const YStack = Tg.YStack as unknown as AnyComp;
export const ZStack = Tg.ZStack as unknown as AnyComp;
export const Text = Tg.Text as unknown as AnyComp;
export const Paragraph = Tg.Paragraph as unknown as AnyComp;
export const H1 = Tg.H1 as unknown as AnyComp;
export const H2 = Tg.H2 as unknown as AnyComp;
export const H3 = Tg.H3 as unknown as AnyComp;
export const H4 = Tg.H4 as unknown as AnyComp;
export const Button = Tg.Button as unknown as AnyComp;
export const Input = Tg.Input as unknown as AnyComp;
export const TextArea = Tg.TextArea as unknown as AnyComp;
export const Label = Tg.Label as unknown as AnyComp;
export const Spinner = Tg.Spinner as unknown as AnyComp;
export const Card = Tg.Card as unknown as AnyComp;
export const Checkbox = Tg.Checkbox as unknown as AnyComp;
export const Dialog = Tg.Dialog as unknown as AnyComp & {
  Trigger: AnyComp;
  Portal: AnyComp;
  Overlay: AnyComp;
  Content: AnyComp;
  Title: AnyComp;
  Description: AnyComp;
  Close: AnyComp;
};
export const Sheet = Tg.Sheet as unknown as AnyComp & {
  Frame: AnyComp;
  Handle: AnyComp;
  Overlay: AnyComp;
};
export const Select = Tg.Select as unknown as AnyComp & {
  Trigger: AnyComp;
  Value: AnyComp;
  Content: AnyComp;
  Viewport: AnyComp;
  Group: AnyComp;
  Item: AnyComp;
  ItemText: AnyComp;
};
export const Adapt = Tg.Adapt as unknown as AnyComp & { Contents: AnyComp };
export { styled } from "tamagui";
