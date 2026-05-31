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
# From repo root (starts Vite on :3001 unless PLAYWRIGHT_SKIP_WEBSERVER=1)
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
