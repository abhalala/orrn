---
name: ORRN
direction: C2 colour-block pop
colors:
  light:
    canvas: "#f4f4f1"
    surface: "#ffffff"
    surfaceSunken: "#efefeb"
    ink: "#0c0c0e"
    inkMuted: "#66666b"
    hairline: "#e7e7e2"
    control: "#85858b"
  dark:
    canvas: "#0c0c0e"
    surface: "#17171a"
    surfaceSunken: "#1f1f23"
    ink: "#f4f4f1"
    inkMuted: "#9a9aa0"
    hairline: "#26262a"
    control: "#6b6b72"
  inkPanel:
    bg: "#0c0c0e"
    fg: "#f4f4f1"
    fgMuted: "#a1a1a8"
    activeBg: "#ffffff"
    activeFg: "#0c0c0e"
  dangerText:
    light: "#b91c1c"
    dark: "#f87171"
  tones:
    green: { from: "#13873f", to: "#0b6b30", on: "#ffffff", tint: "#dcf5e3", ink: "#0d5c2b", tintDark: "#0f2a1a", inkDark: "#7ee2a2" }
    blue: { from: "#2563eb", to: "#1d4ed8", on: "#ffffff", tint: "#e0eaff", ink: "#1a43b8", tintDark: "#132042", inkDark: "#9cbcff" }
    amber: { from: "#ffc21a", to: "#ff9500", on: "#1a1200", tint: "#fff0cc", ink: "#7a4300", tintDark: "#2e2206", inkDark: "#ffd166" }
    red: { from: "#dc2626", to: "#b91c1c", on: "#ffffff", tint: "#fde3e1", ink: "#a01818", tintDark: "#33120f", inkDark: "#ffa49a" }
    violet: { from: "#7c3aed", to: "#6d28d9", on: "#ffffff", tint: "#ede6ff", ink: "#5b21b6", tintDark: "#231637", inkDark: "#c9b5ff" }
    neutral: { from: "#2a2a2e", to: "#0c0c0e", on: "#ffffff", tint: "#ecece7", ink: "#3a3a3e", tintDark: "#26262a", inkDark: "#d4d4d8" }
rounded:
  input: 12px
  card: 16px
  block: 22px
  hero: 26px
  pill: 9999px
spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "7": 32px
  "8": 40px
  "9": 48px
  "10": 56px
typography:
  display: "Bricolage Grotesque Variable (@fontsource-variable/bricolage-grotesque, opsz axis)"
  body: "Geist Variable (@fontsource-variable/geist)"
  mono: "Geist Mono Variable (@fontsource-variable/geist-mono)"
  devanagariFallback: "Noto Sans Devanagari, system-ui"
  scale: { displaySm: 34px, displayMd: 44px, displayLg: 52px, title: 22px, body: 15px, bodyTouch: 16px, small: 13px, micro: 11px }
motion:
  durFast: 150ms
  durBase: 250ms
  easePop: "cubic-bezier(0.2, 0.9, 0.3, 1.35)"
  easeRise: "cubic-bezier(0.2, 0.9, 0.3, 1.15)"
  pressScale: 0.97
shadows:
  sm: "0 1px 2px rgb(12 12 14 / 0.06)"
  md: "0 6px 16px rgb(12 12 14 / 0.10)"
  block: "0 10px 24px rgb(12 12 14 / 0.12)"
  button: "0 6px 16px rgb(12 12 14 / 0.18)"
---

# ORRN design system: C2 "colour-block pop"

Floor-first operational software for an aluminium extrusion plant. A light warm-neutral canvas, ink type, saturated status colour blocks, big Bricolage numbers, black pill buttons, and motion that answers what people do. Dark mode is designed alongside light; the app follows the device theme by default and keeps the manual toggle.

Stack: **Tailwind CSS v4 + shadcn/Radix** on web (`@orrn/ui`), **NativeWind** on native. Token source of truth: `packages/ui/src/tokens.ts`, bridged to CSS variables in `packages/ui/src/styles/globals.css`. `packages/ui/src/tokens.test.ts` (`bun test` in `packages/ui`) checks every text/background pairing against WCAG 2.2 AA and fails if `globals.css` drifts from `tokens.ts`.

The full design brief for screen work lives in the redesign spec (`docs/superpowers/specs/2026-10-03-orrn-c2-redesign-design.md`).

---

## Rules

1. **Status is the colour.** Green = in stock, ready, completed. Blue = reserved, held, in progress. Amber (dark ink on top) = draft, ageing, needs attention. Red = void, cancelled, error, destructive. Violet = Godseye only. Neutral = dispatched, archived, navigation blocks. A status block or chip always shows its status word as well.
2. **One loud element per screen.** Colour blocks are for status and primary navigation tiles. Lists, forms and tables sit on white `surface` cards (16px radius) or directly on the canvas.
3. **Contrast.** Body text >= 4.5:1, large text >= 3:1, control boundaries and focus rings >= 3:1. Text on a gradient block is measured against the lighter stop (the tone stops were darkened from the first mockup to pass). Never lower text contrast with `opacity` on a block.
4. **Radius.** Inputs 12 (`rounded-input`), cards/sheets/dialogs 16 (`rounded-card`), status blocks 22 (`.orrn-block`), hero blocks 26 (`.orrn-block-hero` / `rounded-hero`), buttons and chips pill (`rounded-full`).
5. **Type.** Bricolage (`font-display`) for page titles, big numbers and marketing headlines. Geist (`font-sans`) for everything else. Geist Mono (`font-mono`, tabular numbers) for serials, weights, codes and numbers only, never labels.
6. **Buttons.** Primary = ink pill (`variant="default"`; black on light, off-white on dark). Secondary = surface pill with hairline (`outline`). Destructive = red tone. Default height 44px, `lg` 56px for primary touch actions; compact sizes grow to 44px on coarse pointers.
7. **Focus.** Global `:focus-visible` ring: 2px `--ring` (ink) with 2px offset. Inside ink panels the ring flips to off-white automatically.
8. **Copy.** Sentence case; no ALL-CAPS labels or tracked eyebrows; no em or en dashes; no arrows appended to buttons; plain floor words.
9. **Motion.** `pop` on success, `rise` once on first load, `press` (scale 0.97) on pressables. Transform and opacity only, no ambient loops, everything off under `prefers-reduced-motion`. GSAP only in the marketing chunk (IntersectionObserver/ScrollTrigger, never a scroll listener).

## Tokens in code

| Need | Use |
|---|---|
| Page / card / well | `bg-background` (canvas), `bg-card` (surface), `bg-surface-sunken` |
| Text | `text-foreground` (ink), `text-muted-foreground` (ink-muted), `text-destructive` |
| Lines | `border-border` (hairline), `border-input` (control, >= 3:1) |
| Status chip | `<StatusBadge kind value />`, or `bg-tone-{tone}-tint text-tone-{tone}-ink` |
| Status block | `.orrn-block .orrn-block-{green,blue,amber,red,violet,neutral}` |
| Ink panel | `.orrn-ink-panel` (re-declares the semantic tokens for a near-black surface) |
| Brand mark | `.orrn-mark` (four-tone tile; violet in Godseye) |
| Motion | `.orrn-pop`, `.orrn-rise` (`--rise-delay`), `.orrn-press`, `--ease-pop`, `--ease-rise` |

Legacy class names (`.orrn-glass`, `.orrn-glow`, `.orrn-gradient-text`) still exist but render flat; don't use them in new code. `brandRamp` in `tokens.ts` is deprecated and maps to a neutral ramp.

---

## Implementation guardrails

### Do
- Import components from `@orrn/ui/components/*` instead of raw HTML for standard UI (Buttons, Cards, Inputs, Dialogs, DataTable).
- Respect role-based client-side capability gating with `<Can do="...">`.
- Reference design tokens (CSS vars / Tailwind names above / `@orrn/ui/tokens`), never ad-hoc hex values.
- Structure pages responsively: phone (<768px, bottom nav), tablet (768-1099px, collapsed icon rail), desktop (full sidebar). 16px side gutter on phones, no horizontal scroll at 375px.
- Check every screen in light and dark.

### Don't
- Don't use Tailwind palette colours (`bg-blue-500`, `text-red-600`). Use semantic or tone classes.
- Don't delete the cache cleaning hooks (`TenantCacheGuard` and `queryClient.clear()`) during login/logout.
- Don't accept `companyId` in API client parameters; resolve it on the server from auth context.
- Don't load GSAP outside the public marketing chunk. Three.js is not used.
- Don't nest a `<button>` inside a link (`SidebarItem` renders a non-interactive element when it has no `onPress`).

---

## Surface identities

| Surface | Route group | Shell | Accent |
|---|---|---|---|
| Marketing | `_public` | standalone, light canvas, colour-block composition | Tones + ink pills |
| Auth/Onboarding | `_authed`, `/login` | `AuthScreen`: flat canvas, white card, display-type h1 | Ink |
| Tenant ERP | `_tenant` | `AppShell` (ink sidebar + status bar + mobile nav) | Ink |
| Godseye (platform admin) | `_platform` | `StaffShell` + `.godseye` class | Violet tone |

URLs for Godseye remain `/admin/*`; only the accent layer differs.
