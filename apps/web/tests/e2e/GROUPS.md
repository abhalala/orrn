# e2e groups A / B / C

The 45 spec files run in three groups, one after another on one port pair, never together. Each group starts or
reuses the API + web pair and seeds once through `e2e-setup`. The script defaults to two workers. Membership was
rebalanced from the original alphabetical thirds using the saved per-spec durations: preview-redirects, redirects
and ui-kit moved from C to A. Keep the long store, platform, press and chain flows distributed across the groups.

| Group | Spec files | Saved wall time, runs 1 / 2 |
|---|---|---|
| A | catalog, charts, die-room-share, die-room-w2, die-room, dispatch-w1, dispatch-w2, dispatch, front-door, godseye, gu-w4, guides, imports, preview-redirects, redirects, ui-kit | 351 s / 285 s |
| B | die-room-flows, foundry, foundry-masters, layout-guards, marketing, masters, orders-w2, orders, pack-w1, pack, platform, portal, press, printing-settings, reports | 276 s (failed) / 272 s |
| C | ageing-masters, ageing, chain, collectors, next-rows, orders-plan-purpose, purchase, scan, session, shell, stock-w1, stock, store, today | 287 s / 285 s |

These are **historical measurements, not verification of the current revision**. The interrupted W4-TESTSWEEP-2 run
saved them in `/tmp/W4-TESTSWEEP-2/final-summary.txt` and `final-{1,2}-{A,B,C}.json`. The previous distribution's
baseline wall times were A 258 s, B 300 s, C 356 s (`base-summary.txt`). The rebalanced first B run failed at the
foundry correction's `correct-now` assertion; the second run does not erase that failure. Those runs also used the
subsequently removed retry/warmup helpers, so their green results do not establish the reviewed code is passing.

A new spec goes here and into `apps/web/scripts/e2e-group.sh`. The script keeps the three membership lists in one
place and warns about a spec in none of them. Specs create the data they change and assert on their own rows
(`helpers/own-press.ts`, `helpers/owner-api.ts`, `helpers/fresh-plant.ts`, `helpers/plant-stock.ts`). In particular,
dispatch owns its customer and section: packing on the newest shared die used to consume a chain order's planable kg
(BACKLOG 73). The booking-picker test owns both its confirmed and booking orders rather than waiting for another
spec's shared confirmed line to reappear.

One remaining grouping constraint: `die-room-flows` leaves some copies on trial, while `die-room.spec.ts` counts live
copies of the seed. Keep them in separate groups until the picker test reads its total from the server (BACKLOG 66).

## Running a group

```bash
source .wt-ports.env
export E2E_WORKERS=2
bun run e2e:group A                  # then B, then C; one heavy gate at a time
bun run e2e:group B --retries=1      # diagnostic only; a flaky result still exits non-zero
```

The script calls Playwright directly, with `--retries=0` by default and `--fail-on-flaky-tests` even when a diagnostic
retry is requested. Do not use `bun run --cwd apps/web test:e2e -- <spec>` to filter: Bun can pass the argument such
that the whole suite runs. For a focused check:

```bash
cd apps/web
bunx playwright test --project=e2e --retries=0 tests/e2e/pack.spec.ts
bunx playwright test --project=e2e --retries=0 tests/e2e/chain.spec.ts tests/e2e/dispatch.spec.ts
```

## Load and failures

Do not run server tests, a web build and browser groups concurrently. Reduce concurrent gates before changing a
timeout. A cold route has an explicit first-paint wait where needed; there is no automatic reload, hidden API retry
or swallowed warmup failure. A 5xx response or uncertain write fails the test on its first attempt.

Wait for the observable value being measured (locator count, download, font/layout readiness), not an arbitrary
sleep. The desktop table guard still requires every column to fit within its frame (one-pixel rounding allowance),
not merely 90% of a cell. Approval tests wait for their own pending request to disappear: the always-visible
"Approved" tab is not evidence that the decision has finished. Keep the original assertions when making these waits.

Navigation waits must distinguish the final page from its nested editor: a cast-detail URL pattern ends at the
cast id, rather than also matching `/casts/:id/melt/:meltId`. Picker assertions identify the test's own orders;
the pack order picker also contains the independent Plant stock choice, which is not a sales-order row.

Retain the first failure and its artifacts when diagnosing load. A later pass alone is not proof that the first
failure was environmental; inspect the fixture ownership and the failed behavior before changing product code.
