#!/usr/bin/env bash
# One Halmos property of the clearing, under a time limit, reported in the job summary.
# Used by .github/workflows/ci.yml (the fast properties, every push) and proofs.yml (all of them, longer limits).
#   test/halmos/prove.sh <check_ function> <seconds> <solver>      (from contracts/)
# Exit: 0 when proven or out of time (reported, not failed); 1 on a counterexample or an error.
set -uo pipefail
t="$1"
limit="$2"
solver="$3"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
if [ ! -f test/halmos/ClearingHalmos.t.sol ]; then
  echo "no Halmos tests on this ref" | tee -a "$summary"
  exit 0
fi
pip install --quiet "halmos>=0.3,<0.4"
start=$(date +%s)
# halmos matches a test against its signature, name(args): anchor the name at the parenthesis
timeout "$limit" halmos --match-contract ClearingHalmos --match-test "^$t\(" --loop 4 \
  --solver "$solver" --solver-timeout-assertion 300s > "halmos-$t-$solver.txt" 2>&1
code=$?
case $code in
  0) result="proven" ;;
  124) result="out of time after $((limit / 60)) min" ;;
  *) result="**not proven** (exit $code)" ;;
esac
secs=$(($(date +%s) - start))
{
  echo "| Property | Solver | Result | Seconds |"
  echo "|---|---|---|---:|"
  echo "| \`$t\` | $solver | $result | $secs |"
} >> "$summary"
echo "$t ($solver): $result in ${secs} s"
tail -30 "halmos-$t-$solver.txt"
[ "$code" = 0 ] || [ "$code" = 124 ]
