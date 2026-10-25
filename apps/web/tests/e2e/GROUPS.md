# e2e groups A / B / C

The full e2e suite (45 spec files) is too long and too heavy for one Playwright run on a
shared machine, so the mergers ran it in three groups, split by spec file name (alphabetical thirds, each about 10
minutes at `E2E_WORKERS=2`). Each group boots the same API + web pair, seeds once through `e2e-setup`, and runs its
files in parallel; the groups are run one after another, never together on one port pair.

| Group | Spec files | Tests listed | Passed in the MERGER-11 run (wt/FP after TESTSWEEP) |
|---|---|---|---|
| A | catalog, charts, die-room-share, die-room-w2, die-room, dispatch-w1, dispatch-w2, dispatch, front-door, godseye, gu-w4, guides, imports | 316 + 9 (die-room-share, FP-DR-20) | 306 (+10 screenshot skips) at MERGER-11; die-room-share 9/9 on wt/DR-20 |
| B | die-room-flows, foundry, foundry-masters, layout-guards, marketing, masters, orders-w2, orders, pack-w1, pack, platform, portal, press, printing-settings, reports | 355 + the two foundry specs (47) | 355 |
| C | ageing-masters, ageing, chain, collectors, next-rows, orders-plan-purpose, preview-redirects, purchase, redirects, scan, session, shell, stock-w1, stock, store, today, ui-kit | 457 | 443 (+14 skips: screenshots, chain ageing step) |

A new spec file must be added to a group here AND in `apps/web/scripts/e2e-group.sh` (the script warns when a spec
file is in no group). Specs build what they change (own customer, orders, press line, bundles; see `helpers/own-press.ts`,
`helpers/owner-api.ts`, `helpers/fresh-plant.ts`) and assert only on their own rows when they read a shared list, so
the files inside a group can run in any order on any worker count.

One known exception: `die-room-flows` makes copies of its own and cannot retire the ones it leaves on trial, while
`die-room.spec.ts` (copy picker, "Showing 10 of 3x") counts every live copy of the seed. Keep the two in different
groups until the picker test reads its total from the server (MERGER-11 moved `die-room-flows` to B).

## Running a group

```bash
source .wt-ports.env                 # your worktree's ports; the config refuses to run without them
export E2E_WORKERS=2                 # the machine is shared: never more than 2 workers
bun run e2e:group A                  # from the repo root (also: B, C)
bun run e2e:group B --retries=1      # extra Playwright flags pass through
```

`bun run e2e:group` calls `bunx playwright test --project=e2e <the group's files>` itself. Do NOT use
`bun run --cwd apps/web test:e2e -- <spec>` to filter: bun passes the filter oddly and the whole suite can run
(COMMON rule 13). One spec on its own:

```bash
cd apps/web && bunx playwright test --project=e2e tests/e2e/pack-w1.spec.ts
```

## Flaky under load?

Rerun the failing spec alone first (above). A test that only fails when other gates share the machine is a flake to
fix in the test (wait for the thing it measures: fonts and two frames for a layout read, scroll settle for a
focus-scroll read, the `download` event for a generated file, network idle for "nothing appeared" checks), not a
reason to loosen an assertion.
