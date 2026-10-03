# orrn C2 redesign — design spec

Date: 2026-10-03 · Branch: `redesign/c2` · Status: approved direction, self-reviewed

## 1. Intent

**What the user asked for:** a ground-up redesign of every orrn surface (marketing hero, auth, every ERP screen and form, the platform console), "Apple-level software for enterprise", minimal and modern, working well on phone, iPad and laptop, with routes simplified where they don't make sense. SOPs added. Web **and** native. Ship it to `main` (dev.orrn.app) and `prod` (orrn.in) through the existing Alchemy/Cloudflare pipeline. The existing code was written by assorted AI tools, so audit it rather than trust it.

**Why now:** the 2026-09-13 decision is to rebuild orrn's backend on Postgres/MQTT later. This redesign is the stopgap that makes the current Cloudflare app usable now and becomes the **UI spec the rebuild copies**. So: backend behaviour stays, except for real bugs found by the audit and small read-only additions a new screen needs.

**Users:** packing and dispatch operators on the floor (non-technical, phones/tablets, sometimes gloves and sunlight, Hindi-first), office staff and the owner (laptop), platform staff (Godseye).

**Decisions made with the user**

| Topic | Decision |
|---|---|
| Purpose | Stopgap + UI spec for the rebuild |
| Visual direction | **C2 "colour-block pop"**: floor-first sizing, saturated status colour blocks, Bricolage numbers, black pill buttons, motion |
| SOPs | Redesign the workflows **and** add per-flow SOP pages |
| Platforms | Web **and** native (Expo) |
| Language | English default + one-tap Hindi; SOPs in Hindi with English terms, English alongside |
| Deploy | `main` → dev.orrn.app, then `prod` → orrn.in once dev is green |
| Route map | Approved as drawn in the companion (§4) |

**Success looks like**
- An operator can pack a session and print labels, or build and complete a dispatch, on a phone without help, with the How-to sheet one tap away.
- Every screen works at 375, 820 and 1280+ px wide with no horizontal scroll, keyboard and screen-reader basics pass.
- Weights show in kg, lengths in the company unit, kg/12ft is correct everywhere.
- Old URLs redirect. No backend procedure is removed.
- `check-types`, unit tests, Playwright suites pass; CI deploys dev then prod green.

## 2. Design system (C2)

### Tokens (single source: `packages/ui/src/tokens.ts`, bridged to CSS vars for web and NativeWind theme for native)
- **Canvas** light `#f4f4f1`, surface `#ffffff`, ink `#0c0c0e`, muted ink `#6b6b70`, hairline `#e7e7e2`. **Dark** canvas `#0c0c0e`, surface `#17171a`, ink `#f4f4f1`, muted `#9a9aa0`, hairline `#26262a`. Theme follows device; manual override in avatar menu.
- **Status colours (the core idea: status *is* the colour)**, each a 2-stop gradient for blocks plus a soft tint and ink for chips:
  - green `#22c55e→#0f9f48` = in stock / ready / completed
  - blue `#3b8bff→#1f5fe0` = reserved / held / in progress
  - amber `#ffc21a→#ff9500` (dark ink on top) = ageing / attention / draft needing action
  - red `#ff5a3c→#e8361b` = void / cancelled / error / dispatch area accent
  - violet `#a855f7→#7c3aed` = Godseye only
  - neutral black block = navigation/actions that aren't a status
- **Type**: Bricolage Grotesque (display: titles, big numbers; tracking −0.03em), Geist (body), Geist Mono (serials, weights, codes, tabular numbers). Loaded via `@fontsource-variable/*` on web (no Google CDN at runtime), `expo-font` on native.
- **Scale**: display 34/44/52, title 22, body 15 (16 on touch), small 13, micro 11. Numbers in blocks 44–52.
- **Shape**: radius 12 (inputs), 16 (cards), 22 (blocks), 26 (hero blocks), pill buttons. Shadows soft (`0 10px 24px rgb(0 0 0 / .12)`); no borders on blocks.
- **Touch**: min target 44px everywhere, **56px** for primary actions on touch layouts; primary actions full-width and thumb-reachable (sticky bottom bar) on phones.

### Motion (named, reusable)
- `pop` spring scale 0.6→1.08→1 (success: scan OK, bundle added, dispatch done)
- `rise` 14px slide-up + fade, staggered 60–80 ms (tiles, list entry)
- `press` scale 0.97 on press for every pressable
- `sheet` slide-up with spring (bottom sheets, phone) / slide-in (side panel, laptop)
- `shimmer` one-shot sheen across a success block
- Number count-up for KPI blocks on first render.
- Web: CSS keyframes + a tiny `useCountUp` hook; native: Reanimated + `expo-haptics` (success = notificationSuccess, error = notificationError).
- `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled` disables all of it except opacity.
- GSAP allowed only in the marketing chunk. Three.js removed entirely.

### Components (`@orrn/ui`, web; native twins in `apps/native/components/ui`)
`StatusBlock` (gradient tile with title, meta, big number, optional progress), `BigNumber`, `ActionTile`, `Button` (pill; variants primary-black, secondary-white, danger, ghost; sizes md/lg-touch), `IconButton`, `Chip` (status tint), `ListRow` (row on phones → `DataTable` on ≥1024px via one `ResponsiveList`), `Sheet` (bottom sheet on phone, side panel ≥1024), `Dialog` (confirmations only), `Stepper`, `Field` (label, hint, inline error) with `TextInput`, `NumberInput` (inputMode decimal, kg/ft suffix, rejects NaN/negatives), `Select`/`Combobox` (searchable, recent-first), `SegmentedControl`, `Tabs`, `EmptyState` (one sentence + one action), `Skeleton`, `Toast`, `ScanSheet`, `HowToButton` + `GuideSheet`, `LanguageToggle`, `ImpersonationBanner`, `PageHeader` (large title, subtitle, actions; collapses on scroll on phones).

### Shell
- **Phone (<768)**: top large title; **bottom tab bar** Today · Pack · **Scan** (raised green centre) · Stock · Dispatch. Avatar (top-right) opens *More*: Dies, Customers, Printing, Guides, Settings, language, theme, sign out. Tab bar hides on scroll down, returns on scroll up; never hidden inside flows' sticky action bar.
- **iPad (768–1279)**: left **icon rail** (same items + More group), expands to sidebar in landscape ≥1024; content max width 1100.
- **Laptop (≥1280)**: full **sidebar** (Today, Pack, Stock, Dispatch; *More*: Dies, Customers, Printing, Guides, Settings), "Scan or search ⌘K" field at top opening a command palette that resolves serials, dispatch codes, dies, customers, and pages.
- All nav uses router `Link` (no full reloads). Items filtered by permission **and company modules**.
- Status bar content (company, role, user menu) moves into the sidebar footer / avatar menu.
- Godseye uses the same shell with violet accent and its own nav.

### Language
- New package `@orrn/i18n`: `en.ts` (source of truth, typed keys) and `hi.ts` (must have identical keys; CI test enforces), `useT()` hook for web and native, locale persisted per device (localStorage / SecureStore) and toggled in the avatar menu and on the login screen.
- Serials, codes, units and numbers stay Latin script. Number formatting `en-IN`.
- Hindi strings are drafted by us and flagged for review by Lalubhai (listed in `docs/superpowers/review/hindi-review.md`).

### Domain maths & formatting (new package `@orrn/domain`, shared by server, web and native, unit-tested)
- Weight: `weightG/1000` shown as kg, 2 decimals (`52.40 kg`); totals 1 decimal with grouping (`18,940.5 kg`).
- Length: company `settings.lengthUnit` (`mm` | `inch`) for input; display adds feet+inches for inch companies (`12 ft` / `11 ft 6 in`).
- **kg/12ft** = `(weightKg / pcs) / lengthFt × 12` where `lengthFt = lengthMm / 304.8`.
- **Weight range /12'** = `floor((kg12ft + 0.01) × 10) / 10` (the plant's billed number).
- Dates `d MMM` (+ year if not current), times 24h, all in company timezone when set, else device.

## 3. Screens & flows

Every flow screen has a **How to** button opening the matching guide in a sheet.

### Front door
- **`/` marketing hero** (rewritten): huge Bricolage headline ("Every bundle, accounted for."), one-line plain explanation, CTAs *Request access* / *Sign in*; product visual = live-feeling CSS/GSAP composition of the phone scan-pop and stock colour blocks (no Three.js, no fake metrics). Sections: the flow (Pack → Stock → Dispatch as three colour blocks with micro-demos) · built for the floor (big buttons, Hindi, camera scan, any phone) · for the office (live stock by section, packing list with a real header, LAN label printing) · your data stays yours (tenant isolation, audit log, roles — plain words) · final CTA · footer. Copy passes `unslop`. Reduced-motion = static.
- **`/login`**: laptop split (left colour-block brand panel with gently animated tiles, right form), phone single column. Email, password, TOTP step, language toggle. Errors inline.
- **`/request-access`** (was `/waitlist`): same fields as today (company, name, work email, extrusion lines, preferred date/time, notes), friendlier layout, success state.
- **`/invite/:token`**: shows company name and role being joined; name, email, password; then into `/welcome` if steps remain.
- **`/welcome`**: one stepper showing only the steps this user still needs, derived from `auth.me`: set password (magic-link owners, or forced change for temp-password staff) → two-factor (owners from waitlist approval) → company details (owner/admin when onboarding incomplete: terms, location, contact, timezone, presses) → done. Old `/setup-credentials`, `/onboarding`, `/change-password` redirect here preserving their behaviour.
- **`/no-access`**: explains the account isn't in a company, shows the signed-in email, "Ask your admin to invite this email", *Sign out / use another account*.

### Today (`/today`, was `/dashboard`)
- Header: greeting + date; KPI blocks with count-up: **kg packed today**, **bundles packed today**, **kg dispatched today**, **in stock (bundles · kg)**.
- Action tiles by role/permission: Pack (blue), Dispatch (red, shows open count), Stock (amber), Guides (black). Viewers see no action tiles, only numbers.
- Lists: open dispatches (draft/held, with bundle/kg progress), today's packing sessions, print problems (failed jobs, if `spool.view_queue`).
- Empty company: one "Start here" checklist (add a die, add a customer, pack first bundles, connect a printer) instead of empty widgets.
- Needs new read-only `dashboard.today` (see §5).

### Pack (`/pack`, was `/receipts`)
- **`/pack`**: sessions list (today first): code, die/section, bundles, kg, who, when. Big *New packing session*.
- **`/pack/new`** stepper (designed so a typical bundle needs only two inputs):
  1. **Die & defaults**: searchable die list (recent first, section, series, weight range; archived hidden), then the session defaults: **cut length** (company unit; inch companies enter feet + inches) and optional **PO**. In the plant a session is one die and almost always one cut length.
  2. **Bundles**: one large open card with just **Weight (kg)** and **Pieces** (numeric keypad on touch, Enter/Next moves weight → pieces → saves the bundle and opens the next). Live **kg/12ft** with a green chip in range or an amber "below/above range" chip. Saved bundles collapse to one-line rows above (`52.40 kg · 21 pcs · 12 ft · 2.50`), tap to edit or remove. A *Different length / PO* toggle on the open card overrides the defaults for odd bundles. Sticky bar shows running totals and *Review*.
  3. **Review & save**: totals (bundles, pieces, kg), list, *Save & print labels* (if a spool deployment is active) or *Save*. On success: `pop`, then route to the session with a print summary.
- **`/pack/:id`**: session header (code, die, PO, unit, who/when), bundle list with status chips, *Reprint* per bundle, *Print all labels*, links to bundles.
- Payload stays `bundle.createReceipt` (weight converted kg→g, length to mm). Pack is gated by `bundle.create` (operators have it; today the UI wrongly gates it by `receipt.create`, which operators lack).

### Scan (global)
- Centre tab (phone/native), rail/sidebar button + `⌘K` (laptop).
- **Native**: `expo-camera` barcode scanning (QR + Code128), torch toggle, haptic on read.
- **Web**: `BarcodeDetector` where available, else the `barcode-detector` ponyfill (zxing-wasm) lazy-loaded; camera permission prompt explained first. Hardware wedge scanners work because the manual field always has focus on laptop.
- Input resolution: a serial (`BG-000001-B001`), or a URL ending in `/b/<serial>`. Unknown → "Not found in this company".
- **Context-aware**: opened from a dispatch build step → continuous mode adds each bundle to that dispatch with `pop` + running count, rejects with reason (reserved elsewhere, void, dispatched, wrong status). Otherwise → opens the bundle sheet.

### Stock (`/stock`)
- Segmented control **Sections | Bundles**.
- **Sections**: `StatusBlock` per die from `bundle.stockSummary` (green, big number = available bundles, meta = die code, kg/12ft range, kg), reserved count as blue chip. Search + sort (most kg, A–Z). Totals header.
- **`/stock/:dieId`**: bundles of one section (available first), filter chips by status.
- **`/stock/bundles`** (was `/bundles`): all bundles, status chips (All, In stock, Held, Dispatched, Void), serial/PO search, paginated. *Import legacy bundles* moves into More → Settings → Data (owner/admin).
- **`/b/:serial`** bundle detail (was `/bundles/:id`): hero block coloured by status, serial in Bricolage, facts grid (weight, pieces, cut length, kg/12ft → range, die/section, PO, session), timeline from status history, current dispatch link. Actions: *Add to dispatch* (sheet listing draft dispatches), *Reprint label*, *Void* / *Restore* with reason (Can `bundle.transition`). Needs read-only `bundle.getBySerial` (§5).

### Dispatch (`/dispatch`)
- **`/dispatch`**: status tabs **Building** (draft) · **Held** (reserved) · **Dispatched** (completed) · **Cancelled**; rows show code, customer, ship date, bundles, **kg**, status colour.
- **`/dispatch/new`**: customer combobox (recent first, inline *New customer* sheet), optional ship date, notes → create → straight into Build.
- **`/dispatch/:id`**: header block (customer, code, status colour, bundles, kg). Stepper **Build → Hold → Dispatch**.
  - **Build** (draft): primary *Scan bundles* (continuous ScanSheet), *Paste serials* (sheet; reports added / skipped with reasons), search-add. Items grouped by section with subtotals, as a table with headers (Serial, Weight kg, Pcs, kg/12ft, remove) on wide screens and compact rows on phones; newly added rows `pop` and tint green briefly; per-group *packing group label*; remove is a labelled icon button. Sticky bar: *Hold stock* (reserve) and *Dispatch*.
  - **Hold** (reserved): read-only list, *Release* (unreserve) or *Dispatch*. Adding while held reserves immediately (existing server rule).
  - **Dispatch**: confirmation sheet with totals → `dispatch.complete` → `pop` + shimmer → **Packing list** view.
  - **Packing list** (final state; old `/packing-lists/:id` redirects here): header with company, customer, PL no (dispatch code), date, ship date, totals `157 bundles · 7,856.95 kg`; table mirroring the plant's printed PL (Sr, Bundle no, Item, Weight kg, Cut length ft / in, Pcs, kg/12ft, Weight range /12'), grouped by packing group label. Actions: *Download PDF*, *Download Excel*, *Share* (native), *Regenerate* (manager+).
  - *Cancel* and *Delete* live in an overflow menu with confirmation; only offered in states the server allows.

### More
- **`/dies`**, **`/dies/:id`** (+ `/dies/new`): list with search and status chips; form: series, section code, name, weight range (**kg per 12 ft** in the UI, stored as grams per the existing columns — see open question Q1), status, notes; geometry (width, thickness, oblique, leg) under *Advanced*. Import CSV in list overflow.
- **`/customers`**, **`/customers/:id`** (+ `/customers/new`): list with search; form name, phone, email, GSTIN (tax id), notes, **billing and shipping address** (the server already accepts them); detail shows the customer's dispatches (`listDispatches({customerId})`).
- **`/printing`** (was `/spool`): tabs Queue (retry/cancel), Printers (status), Labels (push template). Raw "variables JSON" job creation moves under *Advanced* (manager+). Empty/restricted states explain what to do.
- **`/guides`**, **`/guides/:slug`**: SOP library (§3.1).
- **`/settings`**: tabs **Company** (name read-only, length unit, timezone — new `company.updateSettings`, permission `settings.update`), **Team** (was `/settings/members`: members, roles, invites), **Printing** (deployment status, printers), **Data** (legacy bundle import, die/customer CSV import; owner/admin).

### Godseye (platform staff, violet)
- **`/admin`**: KPI blocks (active, suspended, pending requests, staff), recent companies, pending requests.
- **`/admin/companies`**, **`/admin/companies/:id`** with tabs **Plan & modules**, **Printing** (spool deployment create / revoke / rotate secret / install script / binaries — moved from `/admin/spool`), **Access** (impersonation grants; *Impersonate* starts a grant and opens `/today` with the banner).
- **`/admin/requests`** (was `/admin/waitlist`), **`/admin/staff`**.
- `/admin/spool` redirects to `/admin/companies` with a Printing filter.

### 3.1 Guides (SOPs)
Typed content in `@orrn/i18n/guides` (`{ slug, roles, title, when, steps[], problems[] }` in `en` and `hi`). Initial set, each mapped to the screen whose How-to opens it:
1. Pack a session and print labels (`/pack/new`)
2. Reprint a label (`/b/:serial`, `/pack/:id`)
3. Scan and check a bundle (Scan)
4. Build a dispatch by scanning (`/dispatch/:id` Build)
5. Hold stock, dispatch, and print the packing list (Hold / Dispatch)
6. Void or restore a bundle (`/b/:serial`)
7. Add or edit a die (`/dies/:id`)
8. Add a customer (`/customers/:id`)
9. Invite a team member and choose a role (`/settings` Team)
10. The printer isn't printing (`/printing`)
They describe orrn's own UI, so they need no plant facts beyond those in memory; any plant-practice line is marked for confirmation.

### 3.2 Route map (old → new; every old path redirects with query preserved)
| Old | New |
|---|---|
| `/dashboard` | `/today` |
| `/receipts`, `/receipts/new`, `/receipts/$id` | `/pack`, `/pack/new`, `/pack/$id` |
| `/bundles`, `/bundles/$id` | `/stock/bundles`, `/b/$serial` (redirect resolves id→serial) |
| `/dispatches`, `/dispatches/new`, `/dispatches/$id` | `/dispatch`, `/dispatch/new`, `/dispatch/$id` |
| `/packing-lists/$id` | `/dispatch/$dispatchId` (resolved via `packingList.get`) |
| `/spool` | `/printing` |
| `/settings/members` | `/settings?tab=team` |
| `/setup-credentials`, `/onboarding`, `/change-password` | `/welcome` |
| `/waitlist` | `/request-access` |
| `/admin/waitlist`, `/admin/spool` | `/admin/requests`, `/admin/companies` |

## 4. Native (Expo)
- expo-router **Tabs**: `(tabs)/today`, `pack`, `scan` (opens full-screen camera modal), `stock`, `dispatch`; stacks for details (`/pack/[id]`, `/b/[serial]`, `/dispatch/[id]`, `/dies/[id]`, `/customers/[id]`); `more` screen from the avatar (Dies, Customers, Guides, Settings → Team read-only + language, sign out). Printing management stays web-only; native shows queue read-only.
- Same flows as web for Pack, Scan, Stock, Bundle, Dispatch (incl. packing list share via `expo-sharing`).
- Removed: drawer, self sign-up on home, API health card, read-only platform waitlist, phone edge-node enrolment (audit N14), manual theme toggle (follows system).
- Fixed config: explicit `EXPO_PUBLIC_SERVER_URL` read (N2), `twoFactorClient` + TOTP step (N5), `react` as peer dep in `@orrn/ui` (N9), app.json ids/icon/splash/camera plugin (N13).
- Uses `@orrn/i18n`, tokens from `@orrn/ui/tokens`, Reanimated, `expo-camera`, `expo-haptics`. Impersonation header never sent from native.
- Shipping to devices needs an EAS build; that is outside this deploy (the code lands on `main`).

## 5. Backend touch points (minimal, all tenant-scoped, tested)
- **New read-only**: `dashboard.today` (one round trip: bundles/kg packed today, kg dispatched today using `dispatch.completedAt`, stock by status, open dispatches, failed print jobs count — day boundary in `company.settings.timezone`, default `Asia/Kolkata`), `bundle.getBySerial` (exact serial within company; same shape as `getBundle`).
- **New mutation**: `company.updateSettings` (`lengthUnit`, `timezone`), guarded by `settings.update`, audited.
- **Bug fixes** (each with a failing test first; full list and evidence in the audit doc): D1 100-parameter chunking (S1), server-side action guards on every ops mutation (S2), auth/ownership/impersonation fixes (S3–S5, S14), status predicates on dispatch/bundle updates (S6 partial), invite URL + email case (S7), atomic sequence (S8), dev-only CORS and seed (S11, S17), duplicate rescan (S13), input bounds (S15), deleted-die conflict (S16), small defects (S18), kg/12ft label formula (S19), impersonation expiry + session handling on web (W2, W11–W13), open redirect (W4), lazy PDF/XLSX (W3), numeric XLSX cells (W17).
- **Server test harness**: `bun test` with Miniflare D1 (migrations applied per test file), a D1 wrapper that throws above 100 bound parameters like production, and `appRouter.createCaller` with a constructed context per role.
- **Dev only**: richer `dev-seed` (fourcubes-like dies, customers, ~120 bundles across states, a few dispatches incl. one completed with a packing list) and a local Wrangler setup (`apps/server/wrangler.local.jsonc`) so the UI can be verified locally without Alchemy state credentials.

## 6. Audit (self-correcting pass)
Three audits ran on the existing code (server correctness & tenant isolation, web front end, native). Findings, the decision for each (fix now / carry into the new UI correctly / flag for the rebuild) and evidence are recorded in `docs/superpowers/review/2026-10-03-audit.md`. Rule: anything the new UI depends on or would expose is fixed with a test; deeper backend issues not touched by the UI are flagged, not silently rewritten.

## 7. Testing & verification
- **Unit (bun test)**: format helpers (kg/12ft, weight range, unit conversions, totals), i18n key parity en↔hi, guide content parity, route-redirect table, new server procedures (tenant scoping, permission), label formula regression.
- **Playwright** (web): public pages visual snapshots regenerated; authed suite against local Wrangler + seed: sign in → Today → pack a session → stock → bundle detail → build dispatch (paste serials) → hold → dispatch → packing list; run at 390×844, 820×1180, 1280×800, light + dark; assert no horizontal overflow; `@axe-core/playwright` with no serious/critical violations on key screens.
- **Native**: `tsc --noEmit`, `expo export` for iOS and Android (bundles compile), Maestro flows updated to the tab bar.
- **Manual visual QA** in the browser pane at each breakpoint, before/after screenshots.
- **Deploy**: merge `redesign/c2` → `main`; watch Deploy Dev; smoke-check dev.orrn.app public pages and login; then fast-forward `prod`; watch Deploy Production; smoke-check orrn.in.

## 8. Out of scope
Backend rebuild (Postgres/MQTT), vehicle number / e-way bill on the packing list (needs a schema field — noted for the rebuild), offline sync, EAS builds / store release, Gujarati, changing the D1 data model.

## 9. Open questions (sent as MCQs, do not block the build)
- **Q1** Die "Min/Max weight" is stored in grams with no unit basis in the UI. Is a die's weight range per **12 ft** (as the catalogue tier ladder suggests)? *(a) yes, kg per 12 ft (b) per piece (c) per metre (d) not sure.* Until answered, the UI labels it "weight range (kg / 12 ft)" and converts g↔kg only.
- **Q2** On the floor, which is entered first when packing a bundle? *(a) weight then pieces (b) pieces then weight (c) either.* Default (a).
- **Q3** Does one packing session (one die) almost always use a single cut length? *(a) yes (b) often mixed (c) not sure.* Default (a), with the per-bundle override.
- **Q4** Should floor operators be able to start and complete a dispatch, or only scan bundles into one the office created? *(a) only scan (today's permission matrix) (b) start + scan (c) start, scan and complete.* Default (a), unchanged.
