---
name: ORRN
colors:
  brand:
    primary: "#5b6cff"
    primarySoft: "#eef0ff"
    primaryStrong: "#3b4edd"
    primaryFg: "#ffffff"
    accent: "#22d3ee"
    accentFg: "#062a33"
  light:
    bg: "#f8fafc"
    bgElevated: "#ffffff"
    bgMuted: "#f1f5f9"
    border: "#e2e8f0"
    borderStrong: "#cbd5e1"
    fg: "#0f172a"
    fgMuted: "#64748b"
    fgSubtle: "#94a3b8"
  dark:
    bg: "#0b0f1a"
    bgElevated: "#121826"
    bgMuted: "#1c2333"
    border: "#1e293b"
    borderStrong: "#3a445e"
    fg: "#f5f7ff"
    fgMuted: "#a3acc4"
    fgSubtle: "#6c7591"
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
  fontFamily: "Inter, sans-serif"
  sizes:
    xs: 11px
    sm: 12px
    md: 14px
    lg: 16px
    xl: 20px
    "2xl": 24px
    "3xl": 30px
    "4xl": 36px
shadows:
  none: "none"
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)"
  md: "0 4px 12px rgba(15, 23, 42, 0.08)"
  lg: "0 12px 32px rgba(15, 23, 42, 0.12)"
---

# ORRN Design System & Styling Rules

ORRN uses an **architectural dark/light premium** design style. It features sleek indigo colors, high contrast text, and subtle gradients. It is built to run on both Web (via Vite + React + Tamagui) and Native (via Expo + Tamagui).

---

## Brand Theme & Aesthetic Guidelines

1. **Aesthetic Philosophy**:
   - Modern, professional, clean. Avoid plain pure-blues/greens.
   - Dominated by dark slate surfaces (`#0b0f1a` base canvas) and elevated dark panels (`#121826`) in Dark Mode.
   - Use high-contrast type scales utilizing the Inter font family.
   
2. **Color Roles**:
   - **Primary Purple/Indigo (`#5b6cff`)**: Used exclusively for primary CTAs, active states, and brand-defining moments.
   - **Accent Cyan (`#22d3ee`)**: Used for secondary brand highlights, platform admin highlights, and active status indicators.
   - **Success/Warning/Danger/Info**: Always use the respective soft background / foreground combination to ensure readable AAA contrast.

---

## Implementation Guardrails

### Do's
- **Do** import components from `@orrn/ui/components/*` instead of creating raw HTML elements for standard UI features (e.g. Buttons, Cards, Inputs).
- **Do** respect role-based client-side capability gating using the `<Can do="...">` component.
- **Do** write CSS/styles that reference ORRN's design system tokens rather than ad-hoc hex values.
- **Do** structure pages responsively. Always design with a mobile-first mind set for Expo native compatibility.

### Don'ts
- **Don't** use standard Tailwind utility colors (e.g. `bg-blue-500`, `text-red-600`). Use brand tokens like `brand.primary`, `semantic.danger`.
- **Don't** delete the cache cleaning hooks (`TenantCacheGuard` and `queryClient.clear()`) during login/logout states.
- **Don't** accept `companyId` in API client parameters; resolve it strictly on the Hono server from auth context.

---

## Onboarding Screen Designs (Stitch MCP Specifications)

### 1. Credentials Setup Screen (`/setup-credentials`)
- **Visual Structure:** A centered, glassmorphic card container on a dark `#0B0F1A` mesh gradient background.
- **Glassmorphic Styling:** `background: rgba(18, 24, 38, 0.7)` with `backdrop-filter: blur(20px)` and a crisp `1px solid rgba(91, 108, 255, 0.15)` border.
- **Step 1 (Password Setup):** Inputs for password entry with dynamic glowing focus states (`#5B6CFF` border) and a micro-animated strength meter.
- **Step 2 (2FA Setup):** A stylized QR code section with a neon blue scanner indicator, one-click copyable secret code, and 6 individual 2FA digits input segments.

### 2. Tenant Onboarding Wizard (`/onboarding`)
- **Visual Structure:** Step-by-step progress checklist (horizontal/vertical) that guides waitlisted managers.
- **Step 1 (Terms):** Framed scrollable T&C area with custom-styled toggle/checkbox consent.
- **Step 2 (Facility Profile):** Compact input grid for location, contact numbers, and timezone dropdowns.
- **Step 3 (Extrusion Setup):** Specialized input for Extrusion Press Count with subtle neon accent borders.
- **CTA:** Sticky premium glowing button (`#5B6CFF` background, low-opacity glow) at the bottom labeled "Complete Onboarding".
