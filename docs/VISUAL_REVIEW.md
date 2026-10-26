# Visual Bug Review — ORRN (Web, Mobile Web, Native)

Review date: 2026-05-31 (updated)  
Scope: layout, theme, responsive behavior, cross-surface parity, export parity, regression automation

## Status summary

| Area | Status |
|------|--------|
| Web / mobile web P0–P1 fixes | ✅ Done (PR #1) |
| Native theme-aware screens | ✅ Done |
| Native `<Can>` permission gating | ✅ Done |
| Native packing list PDF/XLSX export | ✅ Done |
| Tamagui ↔ Uniwind theme sync | ✅ Done |
| Playwright visual baseline (web public routes) | ✅ Added |
| Maestro native smoke flows | ✅ Added |

## Public homepage art direction

The public `/` page uses the existing dark ink-panel tokens and Geist body font regardless of the stored application theme. The four-square logo comes from the existing favicon asset; the wordmark stays lowercase. Login and request-access keep their existing brand-panel copy and routes.

The opening is an original SVG of molten metal passing through a die into an aluminium profile. The production story follows scrap, cast, die, press, age, pack and dispatch. Desktop uses an IntersectionObserver-driven, sticky process illustration; phones show each stage's illustration in the normal reading order. No scroll interception, stock imagery or animation library is required.

Motion has three purposes: a one-time material entrance, process-stage crossfades and link press/hover feedback. Reduced motion disables all animation and transitions. Every stage's text remains visible without the observer. Sample packing-list quantities retain a visible Demo data label and are hidden from assistive technology.

Marketing copy is in the English and Hindi dictionaries. `packages/i18n/src/public-keys.ts` selects the entry subset. After changing its keys or public English copy, run `bun run --cwd packages/i18n gen:public`. Full dictionaries remain lazy.

Inspection targets are 375, 820 and 1280 px in English and Hindi, including keyboard focus, Devanagari line height, reduced motion, the language switch and the auth/guides links. `apps/web/tests/e2e/marketing.spec.ts` retains those behavioral checks, session redirects, SEO localization and the route-budget report. The retired scan collage's pixel geometry, copied headlines and GSAP timeline assertions no longer describe this page. Visual baselines need review after the redesign; this note is not a recorded browser check.

## Surfaces

| Surface | Stack | Breakpoint / chrome |
|---------|-------|---------------------|
| Desktop web | Vite + `@orrn/ui` + Tailwind | Sidebar ≥768px, max 1180px tenant |
| Mobile web | Same | Bottom nav ≤767px, safe-area padding |
| Native | Expo + Uniwind/HeroUI + `@orrn/ui` | Drawer nav, theme toggle syncs Tamagui |

## Shared packages

| Package | Purpose |
|---------|---------|
| `@orrn/ui` | Tamagui design system, `DataTable`, `Dialog`, `StatusBadge` |
| `@orrn/documents` | `PLSnapshot`, XLSX buffer/base64, HTML for native PDF |

## Native ERP UI (`apps/native/components/erp.tsx`)

Theme-aware primitives used across all operational screens:

- Layout: `ErpScreen`, `ErpListCard`, `ErpSummaryGrid`
- Lists: `ErpSearchBar`, `ErpFilterChip`, `ErpCardPressable`, `ErpEmpty`, `ErpLoading`
- Forms: `ErpField`, `ErpTextInput`, `ErpKvRow`
- Status: `@orrn/ui` `StatusBadge` (bundle, dispatch, role)

Tamagui theme follows Uniwind via `ThemedOrrnUiProvider` in `app/_layout.tsx`.

## Export parity

| Platform | PDF | XLSX | Text |
|----------|-----|------|------|
| Web | `@react-pdf/renderer` | `@orrn/documents` → Blob download | — |
| Native | `expo-print` + `@orrn/documents` HTML | `@orrn/documents` base64 + `expo-sharing` | `Share.share()` |

Dispatch detail (`dispatches/[id].tsx`) exposes PDF, XLSX, and Text buttons on completed dispatches.

## Automated regression

### Web — Playwright

```bash
# From repo root (starts Vite on :3001, or on $VISUAL_WEB_PORT in a worktree after
# `source .wt-ports.env`, unless PLAYWRIGHT_SKIP_WEBSERVER=1; see docs/LOCAL_DEV.md)
bun run test:visual

# First-time or intentional UI refresh
bun run test:visual:update
```

- Config: `apps/web/playwright.config.ts`
- Tests: `apps/web/tests/visual/public.spec.ts`
- Projects: desktop/mobile × dark/light
- Snapshots: `apps/web/tests/visual/*-snapshots/`

### Native — Maestro

```bash
# Install Maestro CLI, start dev client, then:
MAESTRO_APP_ID=your.bundle.id bun run test:maestro
```

- Flows: `.maestro/flows/native-home.yaml`, `native-theme-toggle.yaml`
- Theme toggle: `testID="theme-toggle"` on `components/theme-toggle.tsx`

## Manual QA checklist (tenant ERP)

Run with seeded data at **375**, **768**, **1280** px and **dark/light**.

- [ ] `/dashboard`, `/customers`, `/dies` (+ import modal)
- [ ] `/receipts`, `/bundles`, `/stock`, `/dispatches`, `/packing-lists/$id`
- [ ] `/settings/members`, impersonation banner + mobile nav
- [ ] Native: home, lists, bundle/dispatch detail, packing list export
- [ ] Operator role: dispatch lifecycle hidden; add-bundle still visible on draft

## Bug report template

```markdown
## Summary
## Surface (web desktop | mobile web WxH | iOS | Android)
## Theme (dark | light)
## Route / screen
## Steps / Expected / Actual / Screenshot
## Severity (P0–P3)
```

## Follow-up (optional)

- Extend Playwright to authenticated tenant routes (storage state + seed credentials)
- Maestro flows for signed-in drawer navigation and dispatch serial entry
- Percy/Chromatic if team wants hosted snapshot review
