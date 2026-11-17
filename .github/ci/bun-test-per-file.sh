#!/usr/bin/env bash
# Run every bun test file under the current directory in its OWN bun process, JOBS at a time.
#
# Why: several web and i18n test files leave state behind for the rest of a shared bun process
# (mock.module stubs, refusal tables registered on import), so a single `bun test` passes or fails
# depending on file order, and Linux orders files differently from macOS. One process per file
# judges each file on its own. Found on PR #7 (2026-11-17); see the CI report.
#
# Usage (from a package directory): bash ../../.github/ci/bun-test-per-file.sh [skip-list-file] -- <dirs...>
#   skip-list-file: paths relative to the package, one per line, # comments allowed.
set -u
skipfile=""
if [ "${1:-}" != "--" ] && [ -n "${1:-}" ]; then skipfile="$1"; shift; fi
[ "${1:-}" = "--" ] && shift
dirs=("$@"); [ "${#dirs[@]}" -gt 0 ] || dirs=(.)
JOBS="${JOBS:-4}"
LOG_DIR="${LOG_DIR:-$(mktemp -d)}"; mkdir -p "$LOG_DIR"

skip=""
[ -n "$skipfile" ] && skip=$(grep -v '^\s*#' "$skipfile" | grep -v '^\s*$' || true)
files=()
while IFS= read -r f; do files+=("$f"); done < <(find "${dirs[@]}" -path '*/node_modules' -prune -o \( -name '*.test.ts' -o -name '*.test.tsx' \) -print \
  | sed 's#^\./##' | sort | grep -vxF -f <(printf '%s\n' $skip))
[ "${#files[@]}" -gt 0 ] || { echo "no test files" >&2; exit 2; }
[ -n "$skip" ] && { echo "not run here:"; printf '  %s\n' $skip; }
echo "running ${#files[@]} files, $JOBS at a time"

run_one() {
  local f="$1"
  local log="$LOG_DIR/$(echo "$f" | tr '/' '_').log"
  bun test "./$f" >"$log" 2>&1
  local code=$?
  local pass fail
  pass=$(grep -a -E '^ *[0-9]+ pass' "$log" | tail -1 | awk '{print $1}')
  fail=$(grep -a -E '^ *[0-9]+ fail' "$log" | tail -1 | awk '{print $1}')
  if [ "$code" -eq 0 ]; then echo "PASS  $f  pass=${pass:-0}"; else echo "FAIL  $f  pass=${pass:-0} fail=${fail:-?}  log=$log"; fi
}
export -f run_one
export LOG_DIR

results="$LOG_DIR/results.txt"
printf '%s\n' "${files[@]}" | xargs -P "$JOBS" -I{} bash -c 'run_one "$@"' _ {} | sort -k2 >"$results"
grep '^FAIL' "$results" | while read -r _ f _ _ logp; do
  echo "::group::FAIL $f"; tail -60 "${logp#log=}"; echo "::endgroup::"
done
tests=$(sed -E 's/.*pass=([0-9]+).*/\1/' "$results" | awk '{ s += $1 } END { print s + 0 }')
nfail=$(grep -c '^FAIL' "$results")
echo "files=$(wc -l <"$results" | tr -d ' ') fail=$nfail tests passed=$tests"
[ "$nfail" -eq 0 ]
