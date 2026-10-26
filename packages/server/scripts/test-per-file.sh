#!/usr/bin/env bash
# Run every server test file in its OWN bun process and collect the results.
#
# Why: one `bun test` process runs ~100 Miniflare D1 files back to back. On a loaded machine (or on
# Linux CI) one stuck file leaves a "poisoned stub" / ECONNRESET behind and the failure cascades into
# every later file as timeouts. A process per file contains the damage and names the file that broke.
#
# Usage (from the repo root or packages/server):
#   bun run test:server:files                       # all files, JOBS=1 (serial, safest)
#   JOBS=2 bun run test:server:files                # two files at a time
#   bun run test:server:files -- plant-store press  # only files whose name contains one of the words
#   RETRY=1 bun run test:server:files               # re-run a failed file once, alone, before calling it failed
#   TIMEOUT_MS=60000 bun run test:server:files      # per-test timeout override (files with setDefaultTimeout keep theirs)
#
# Output: one line per file, a summary, and per-file logs in $LOG_DIR (default /tmp/orrn-server-tests-<pid>).
# Exit code is non-zero when any file still fails after its retry.
#
# Linux / ICU note: the server tests format no locale-dependent text, but the web unit tests do
# (formatDay, formatInstantDay, instantDateText, companyClock). Those are now pinned to explicit
# Intl format parts, so a Linux box with small-icu or a different CLDR gives the same strings. If you
# see a date-wording failure in `bun run --cwd apps/web test` on Linux, a new assertion is relying on
# Intl's own wording again: build it from formatToParts instead.
set -u
cd "$(dirname "$0")/.."

JOBS="${JOBS:-1}"
RETRY="${RETRY:-1}"
LOG_DIR="${LOG_DIR:-/tmp/orrn-server-tests-$$}"
mkdir -p "$LOG_DIR"

filters=("$@")
[ "${filters[0]:-}" = "--" ] && filters=("${filters[@]:1}")

files=()
for f in test/*.test.ts; do
  if [ "${#filters[@]}" -gt 0 ]; then
    keep=0
    for w in "${filters[@]}"; do case "$f" in *"$w"*) keep=1 ;; esac; done
    [ "$keep" = 1 ] || continue
  fi
  files+=("$f")
done
[ "${#files[@]}" -gt 0 ] || { echo "no test files match" >&2; exit 2; }

run_one() {
  # Two statements: in one `local`, "$f" in the log path would expand before f is set (empty under xargs -P).
  local f="$1"
  local log="$LOG_DIR/$(basename "$f").log" start end
  local flags=""
  [ -n "${TIMEOUT_MS:-}" ] && flags="--timeout $TIMEOUT_MS"
  start=$(date +%s)
  bun test $flags "$f" >"$log" 2>&1
  local code=$?
  if [ "$code" -ne 0 ] && [ "$RETRY" -gt 0 ]; then
    echo "retry $f" >>"$log"
    bun test $flags "$f" >>"$log" 2>&1
    code=$?
    [ "$code" -eq 0 ] && code=100 # passed only on retry: report as FLAKY
  fi
  end=$(date +%s)
  local pass fail
  pass=$(grep -a -E '^ *[0-9]+ pass' "$log" | tail -1 | awk '{print $1}')
  fail=$(grep -a -E '^ *[0-9]+ fail' "$log" | tail -1 | awk '{print $1}')
  case "$code" in
    0) echo "PASS  $f  pass=${pass:-0} fail=${fail:-0} $((end - start))s" ;;
    100) echo "FLAKY $f  pass=${pass:-0} passed on retry (first run failed, see $log) $((end - start))s" ;;
    *) echo "FAIL  $f  pass=${pass:-0} fail=${fail:-?} $((end - start))s  log=$log" ;;
  esac
}
export -f run_one
export LOG_DIR RETRY TIMEOUT_MS

results="$LOG_DIR/results.txt"
: >"$results"
if [ "$JOBS" -le 1 ]; then
  for f in "${files[@]}"; do run_one "$f" | tee -a "$results"; done
else
  printf '%s\n' "${files[@]}" | xargs -P "$JOBS" -I{} bash -c 'run_one "$@"' _ {} | tee -a "$results"
fi

total=$(wc -l <"$results" | tr -d ' ')
npass=$(grep -c '^PASS' "$results"); nflaky=$(grep -c '^FLAKY' "$results"); nfail=$(grep -c '^FAIL' "$results")
tests=$(grep -h -E '^(PASS|FLAKY)' "$results" | sed -E 's/.*pass=([0-9]+).*/\1/' | awk '{ s += $1 } END { print s + 0 }')
echo "--- slowest files"
sed -E 's/^[A-Z]+ +([^ ]+) .* ([0-9]+)s( .*)?$/\2 \1/' "$results" | sort -rn | head -8 | awk '{ printf "  %4ss  %s\n", $1, $2 }'
echo "---"
echo "files=$total pass=$npass flaky=$nflaky fail=$nfail  (tests passed: ${tests:-0})  logs=$LOG_DIR"
[ "$nfail" -eq 0 ]
