---
name: ORRN
colors:
  brand:
    primary: "#4f7cff"
    primarySoft: "#eaf0ff"
    primaryStrong: "#2f5fe8"
    primaryFg: "#ffffff"
    accent: "#2dd4bf"
    accentFg: "#062923"
  godseye:
    primary: "#8b5cf6"
    primaryStrong: "#7c3aed"
    primaryFg: "#ffffff"
  light:
    bg: "#f6f8fb"
    bgElevated: "#ffffff"
    bgMuted: "#edf2f7"
    bgSunken: "#eef2f7"
    border: "#d9e1ea"
    borderStrong: "#cbd5e1"
    fg: "#111827"
    fgMuted: "#5d6b7c"
    fgSubtle: "#8b98a9"
  dark:
    bg: "#070a11"
    bgElevated: "#101722"
    bgMuted: "#182231"
    bgSunken: "#04060c"
    border: "#263142"
    borderStrong: "#3a475a"
    fg: "#f4f7fb"
    fgMuted: "#a7b2c2"
    fgSubtle: "#737f91"
  semantic:
    success: "#10b981"
    successSoft: "#d1fae5"
    successFg: "#064e3b"
    warning: "#f59e0b"
    warningSoft: "#fef3c7"
    warningFg: "#78350f"
    danger: "#ef4444"
    dangerSoft: "#fee2e2"
    dangerFg: "#7f1d1d"
    info: "#3b82f6"
    infoSoft: "#dbeafe"
    infoFg: "#1e3a8a"
rounded:
  none: 0
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  "2xl": 16px
  full: 9999px
spacing:
  "0": 0
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
  "12": 72px
  "16": 96px
typography:
  fontFamily: "Inter Variable, sans-serif"
  sizes:
    xs: 11px
    sm: 12px
    md: 14px
    lg: 16px
    xl: 20px
    "2xl": 24px
    "3xl": 30px
    "4xl": 36px
  display:
    display1: "clamp(2.5rem, 1.2rem + 5.5vw, 6rem)"
    display2: "clamp(1.875rem, 1.1rem + 3vw, 3.5rem)"
    display3: "clamp(1.5rem, 1.2rem + 1.4vw, 2.25rem)"
motion:
  durFast: 150ms
  durBase: 250ms
  durSlow: 400ms
  durSlower: 700ms
  easeOutExpo: "cubic-bezier(0.16, 1, 0.3, 1)"
  easeSpring: "cubic-bezier(0.32, 0.72, 0, 1)"
shadows:
  none: "none"
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)"
  md: "0 4px 12px rgba(15, 23, 42, 0.08)"
  lg: "0 12px 32px rgba(15, 23, 42, 0.12)"
---

# ORRN Design System & Styling Rules

ORRN uses an **architectural dark/light premium** design style: clear brand blue, deep blue-cast dark surfaces, high-contrast Inter type, restrained motion. Stack: **Tailwind CSS v4 + shadcn/Radix** on web (`@orrn/ui`), **NativeWind** on native. Token source of truth: `packages/ui/src/tokens.ts` bridged to CSS vars in `packages/ui/src/styles/globals.css` (web) and `apps/native/global.css` (native).

---

## Brand Theme & Aesthetic Guidelines

1. **Aesthetic Philosophy**:
   - Modern, professional, quiet. Surfaces dominate; color is reserved for action and status.
   - Dark mode is the default: base canvas `#070a11`, elevated panels `#101722`, subtle blue cast for depth.
   - High-contrast type using Inter Variable. Hierarchy via weight and color, not size sprawl.

2. **Color Roles**:
   - **Brand Blue (`#4f7cff`)**: primary CTAs, active nav, focus rings, brand-defining moments. Full ramp available as `brandRamp` (50–950) / `--brand-300..600`.
   - **Accent Teal (`#2dd4bf`)**: explicit secondary highlights only. Never bound to shadcn's neutral `--accent`.
   - **Godseye Violet (`#8b5cf6`)**: platform admin console identity. Applied via the `.godseye` class on the `_platform` layout — overrides `--primary`/`--ring`/sidebar accents so staff always know which surface they're on.
   - **Success/Warning/Danger/Info**: always use the soft background + foreground pairs for readable contrast.

3. **Motion**:
   - Use the motion tokens (`--dur-fast/base/slow/slower`, `--ease-out-expo`, `--ease-spring`) for all transitions; GSAP animations on marketing read the same values from `@orrn/ui/tokens` (`motion`).
   - Respect `prefers-reduced-motion` everywhere — marketing scroll/3D effects must degrade to static content.

4. **Utilities** (defined in `globals.css`):
   - `.orrn-glass` — translucent panel with backdrop blur + solid fallback.
   - `.orrn-gradient-text` — brand gradient headline text.
   - `.orrn-glow` — soft brand glow for hero CTAs.
   - `.orrn-section` — standard marketing section container (max-w-72rem).
   - `.orrn-display-1/2/3` — fluid clamp-based display headlines.

---

## Implementation Guardrails

### Do's
- **Do** import components from `@orrn/ui/components/*` instead of creating raw HTML elements for standard UI features (Buttons, Cards, Inputs, Dialogs, DataTable).
- **Do** respect role-based client-side capability gating using the `<Can do="...">` component.
- **Do** reference design-system tokens (CSS vars / `@orrn/ui/tokens`) rather than ad-hoc hex values.
- **Do** structure pages responsively: mobile (<768px, bottom nav), tablet (768–1100px, collapsed icon rail), desktop (full sidebar).

### Don'ts
- **Don't** use standard Tailwind utility colors (e.g. `bg-blue-500`, `text-red-600`). Use semantic classes (`bg-primary`, `text-destructive`) or brand vars.
- **Don't** delete the cache cleaning hooks (`TenantCacheGuard` and `queryClient.clear()`) during login/logout states.
- **Don't** accept `companyId` in API client parameters; resolve it strictly on the Hono server from auth context.
- **Don't** load Three.js or GSAP outside the public marketing chunk — app-shell bundle stays animation-library-free.

---

## Surface Identities

| Surface | Route group | Shell | Accent |
|---|---|---|---|
| Marketing | `_public` | standalone | Brand blue + teal, glass header, GSAP/Three hero |
| Auth/Onboarding | `_authed`, `/login` | centered glass card on gradient backdrop | Brand blue |
| Tenant ERP | `_tenant` | `AppShell` (sidebar + status bar + mobile nav) | Brand blue |
| Godseye (platform admin) | `_platform` | `StaffShell` + `.godseye` class | Violet `#8b5cf6` |

URLs for Godseye remain `/admin/*`; only the brand layer differs.
