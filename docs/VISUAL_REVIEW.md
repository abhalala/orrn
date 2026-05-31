# Visual Bug Review — ORRN (Web, Mobile Web, Native)

Review date: 2026-05-31  
Scope: layout, theme, responsive behavior, cross-surface parity, broken navigation  
Method: static code audit + targeted fixes (no Playwright/Maestro baseline yet)

## Surfaces

| Surface | Primary stack | Breakpoint / chrome |
|---------|---------------|---------------------|
| Desktop web | Vite + `@orrn/ui` Tamagui + Tailwind bridge | Sidebar ≥768px, max content 1180px (tenant) |
| Mobile web | Same as desktop | Nav flip at **767px**, bottom `MobileNav`, content `paddingBottom: 84` |
| Native | Expo + mixed HeroUI / Tamagui / StyleSheet | Drawer nav, no automated visual tests |

## Fixes applied in this pass

### Shared (`packages/ui`)

| Issue | Severity | Fix |
|-------|----------|-----|
| `DataTable` columns squish / clip on narrow viewports | P1 | Horizontal scroll wrapper + computed `minWidth` per column |
| Mobile bottom nav lacks safe-area inset | P2 | `env(safe-area-inset-bottom)` on `.orrn-mobile-nav` |
| Auth cards can overflow viewport height on mobile | P2 | `max-height` + scroll on `.orrn-auth-card` ≤767px |
| Mobile nav could shrink in flex layout | P2 | `flexShrink={0}` + `zIndex={20}` on `MobileNav` |

### Web (`apps/web`)

| Issue | Severity | Fix |
|-------|----------|-----|
| `ImportDiesModal` custom overlay (z-index / theme drift) | P1 | Migrated to `@orrn/ui/Dialog` |
| `dispatches/new` raw `<select>` / `<textarea>` | P1 | `@orrn/ui/Select` + `TextArea` |

### Native (`apps/native`)

| Issue | Severity | Fix |
|-------|----------|-----|
| Dies list `+` → `/dies/new` (route missing) | **P0** | Removed header action (die create is web-only today) |
| Customers list `+` → `/customers/new` (missing) | **P0** | Removed header action |
| Stock summary always shows mm | P1 | `useLengthUnit()` for length label + formatted total |
| Dispatch detail shows lifecycle actions to operators | P1 | Wrapped actions in `<Can>` (matches web) |
| Bundle void/restore visible without permission | P1 | `<Can do="bundle.transition">` |
| List header `+` buttons ignore permissions | P1 | `<Can>` on dispatches/receipts/bundles create shortcuts |
| `dispatches/new` reachable without permission | P1 | Screen wrapped in `<Can do="dispatch.create">` with fallback message |

## Open backlog (documented, not fixed)

### P1 — Theme / design system

- **Native operational screens** (lists, forms) still use hardcoded light `StyleSheet` colors while home/detail use HeroUI/Tamagui. Dark mode toggle does not affect floor-worker screens.
- **Status pills** on native lists duplicate hex colors instead of `@orrn/ui` `StatusBadge` / `bundleStatusTones`.
- **Web Tamagui + Tailwind hybrid**: pages mixing `$tokens` and `text-muted-foreground` classes — regression risk on theme changes.

### P2 — UX polish

- **Breadcrumbs** with UUID path segments on detail pages (long overflow on mobile web).
- **Native dispatch action row**: four lifecycle buttons wrap tightly on small phones; consider vertical stack.
- **Native packing list**: Share sheet only vs web PDF/XLSX (intentional parity gap until client export on native).
- **Print queue / offline sync UI**: not implemented (M10/M12).

### P3 — Future automation

- No Storybook, Playwright, Maestro, or Percy in repo.
- Recommended next step: Playwright screenshot sweep for `_tenant` routes at 375px + 1280px, dark + light.

## Route checklist (manual QA)

Use seeded tenant data; capture screenshots at **375**, **768**, **1280** widths and **dark/light**.

### Tenant ERP (priority)

- [ ] `/dashboard`
- [ ] `/customers`, `/customers/$id`
- [ ] `/dies`, `/dies/$id`, import modal
- [ ] `/receipts`, `/receipts/new`, `/receipts/$id`
- [ ] `/bundles`, `/bundles/$id`
- [ ] `/stock/?status=`
- [ ] `/dispatches`, `/dispatches/new`, `/dispatches/$id`
- [ ] `/packing-lists/$id`
- [ ] `/settings/members`

### Native drawer (priority)

- [ ] `(drawer)/index`, bundles, dispatches, receipts, stock
- [ ] `bundles/[id]`, `dispatches/[id]`, `receipts/new`
- [ ] Operator role: confirm lifecycle buttons hidden on dispatch detail

### Public / platform

- [ ] `/`, `/login`, `/waitlist`
- [ ] `/admin/*` with impersonation banner + mobile nav stacking

## Bug report template

```markdown
## Summary
## Surface (web desktop | mobile web WxH | iOS | Android)
## Theme (dark | light)
## Route / screen
## Steps
## Expected / Actual
## Screenshot
## Severity (P0–P3)
```

## Regression guardrails

When changing UI:

1. Run `bun run check-types` (web build includes Tamagui extract).
2. Spot-check `DataTable` on mobile web after column changes (horizontal scroll).
3. Wrap new mutation buttons in `<Can>` on web and native.
4. Do not add native routes without matching screen files.
