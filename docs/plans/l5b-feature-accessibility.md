# L5b feature accessibility spec

## Outcome

Bring the assigned web feature folders to WCAG 2.2 AA for the issues in the lane brief, preserve behaviour and existing test selectors, add translated accessible names only where existing keys do not fit, and commit each feature separately.

## Decisions

- Edit only `apps/web/src/features/{press,foundry,ageing,printing,settings,portal,masters,store,purchase,reports,admin,audit,approvals,imports,guides,dev-kit}` and the permitted i18n dictionaries.
- Shared component and shell fixes are findings for lane L4, not edits here.
- Do not change data flow, permissions, server code or existing copy values.
- Do not run e2e or the web build. Inspect e2e selectors and run the required unit, type and i18n gates.
- Keep the external findings report at `.unslop-build/reports/L5b.md` in the main checkout current.

## Acceptance checks

- [x] unit: `bun run --cwd packages/i18n test` passes, 60 tests and 2287 assertions.
- [x] unit: `bun run --cwd apps/web test` passes, 1457 tests and 6333 assertions.
- [ ] unit: `bun run check-types` completes without TypeScript errors. It timed out twice after completed Vite builds, and direct checks timed out without a diagnostic.

## Checklist

### Plan and audit

- [x] Read every TSX file in `press` and fix owned findings.
- [x] Read every TSX file in `foundry` and fix owned findings.
- [x] Read every TSX file in `ageing` and fix owned findings.
- [x] Read every TSX file in `printing`, including the label studio keyboard path, and fix owned findings.
- [x] Read every TSX file in `settings` and fix owned findings.
- [x] Read every TSX file in `portal` and fix owned findings.
- [x] Read every TSX file in `masters` and fix owned findings.
- [x] Read every TSX file in `store` and fix owned findings.
- [x] Read every TSX file in `purchase` and fix owned findings.
- [x] Read every TSX file in `reports` and fix owned findings.
- [x] Read every TSX file in `admin` and fix owned findings.
- [x] Read every TSX file in `audit` and fix owned findings.
- [x] Read every TSX file in `approvals` and fix owned findings.
- [x] Read every TSX file in `imports` and fix owned findings.
- [x] Read every TSX file in `guides` and fix owned findings.
- [x] Read every TSX file in `dev-kit` and fix owned findings.
- [x] Check the axe baseline at start and halfway; fix every finding owned by these folders.
- [x] Add required `a11y` keys at the end of each feature namespace in en, hi and required gu files without changing existing values.
- [x] Grep `apps/web/tests/e2e` for affected roles, labels and test ids and preserve selectors.

### Verification and delivery

- [x] Run `bun install`.
- [x] Run `bun run --cwd packages/i18n export-review` if keys change and commit generated output. No keys changed, so this was not needed.
- [x] Run `bun run --cwd packages/i18n test`.
- [x] Run `bun run check-types`. It timed out at 300s and 600s after completed Vite builds; direct TypeScript checks also timed out with no diagnostic.
- [x] Run `bun run --cwd apps/web test`.
- [x] Run `bun run --cwd apps/native test` if i18n changes. Not required because i18n did not change.
- [x] Commit each changed feature folder with `fix(a11y):` and the required co-author trailer.
- [x] Remove generated test and build output listed in COMMON.md and stop any server started here.
- [x] Record the final branch, worktree, head SHA, commit count, gate summaries, findings and L4 handoffs in the external report.
