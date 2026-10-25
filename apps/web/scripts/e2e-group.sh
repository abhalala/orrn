#!/usr/bin/env bash
# Run one e2e group (A, B or C) with Playwright directly. See tests/e2e/GROUPS.md.
#
#   source .wt-ports.env            # your worktree's ports (the config refuses to run without them)
#   bun run e2e:group A             # from the repo root
#   bun run e2e:group B --retries=1 # extra playwright flags pass through
#   E2E_WORKERS=2 bun run e2e:group C
#
# It calls `playwright test --project=e2e <spec files>` itself. `bun run test:e2e -- <spec>` can run the
# WHOLE suite because bun passes the filter oddly (COMMON rule 13), so this never goes through it.
set -eu
cd "$(dirname "$0")/.."

group="${1:-}"
[ -n "$group" ] || { echo "usage: e2e-group.sh A|B|C [playwright flags]" >&2; exit 2; }
shift

case "$(printf '%s' "$group" | tr '[:lower:]' '[:upper:]')" in
  A) specs="catalog charts die-room-flows die-room-w2 die-room dispatch-w1 dispatch-w2 dispatch front-door godseye gu-w4 guides imports" ;;
  B) specs="layout-guards marketing masters orders-w2 orders pack-w1 pack platform portal press printing-settings reports" ;;
  C) specs="chain collectors next-rows orders-plan-purpose preview-redirects purchase redirects scan session shell stock-w1 stock store today ui-kit" ;;
  *) echo "unknown group '$group' (use A, B or C)" >&2; exit 2 ;;
esac

files=()
for s in $specs; do files+=("tests/e2e/$s.spec.ts"); done
for f in "${files[@]}"; do [ -f "$f" ] || { echo "GROUPS.md is out of date: $f is gone" >&2; exit 2; }; done

# A spec file not in any group would silently never run: say so.
for f in tests/e2e/*.spec.ts; do
  name="$(basename "$f" .spec.ts)"
  case " catalog chain charts collectors die-room-flows die-room-w2 die-room dispatch-w1 dispatch-w2 dispatch front-door godseye gu-w4 guides imports layout-guards marketing masters next-rows orders-plan-purpose orders-w2 orders pack-w1 pack platform portal press preview-redirects printing-settings purchase redirects reports scan session shell stock-w1 stock store today ui-kit " in
    *" $name "*) ;;
    *) echo "warning: $f is in no group (add it to GROUPS.md and this script)" >&2 ;;
  esac
done

exec bunx playwright test --project=e2e "${files[@]}" "$@"
