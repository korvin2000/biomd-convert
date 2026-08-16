#!/bin/sh
set -e
cd "$(dirname "$0")/.."
npx tsc -p tsconfig.json
# Prompt templates are not TypeScript, so `tsc` alone leaves dist/ with hooks
# that cannot find their prompts.
node tools/copy-prompts.mjs
rm -rf bench/out
mkdir -p bench/out
node dist/cli/index.js corpus run -c bench/biomd.config.json > bench/last-run.txt 2>&1 || true
# A crashed conversion leaves no output file; scoring a stale one silently
# invents an improvement. Refuse to report a number in that case.
if grep -q '^FAILED' bench/last-run.txt; then
  echo "!!! conversion failures — score below would be meaningless:"
  grep '^FAILED' bench/last-run.txt
  exit 1
fi
# The summary block grew when the run report was added; keep the whole of it.
tail -8 bench/last-run.txt
node dist/cli/index.js eval -c bench/biomd.config.json --json bench/last.json | tail -18
