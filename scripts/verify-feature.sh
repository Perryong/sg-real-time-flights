#!/bin/sh
# Verify the personal tracker against local, synthetic data.
set -eu
cd "$(dirname "$0")/.."
python_bin=${PYTHON:-python3}
for tool in redis-server redis-cli; do
  command -v "$tool" >/dev/null || { echo "Install $tool to run the shared-cache tests." >&2; exit 1; }
done
export LIVE_ENABLED=false ADSBFI_PERSONAL_USE=false FLYITALYADSB_ENABLED=false OPENSKY_ENABLED=false
"$python_bin" -m pytest -q
PYTHONPATH=. "$python_bin" scripts/build_fixtures.py --check
"$python_bin" scripts/verify_airport.py
npm --prefix frontend test
# Use the same synthetic Pages bundle locally and on PRs, even on a configured checkout.
export VITE_API_BASE_URL='' VITE_LIVE_TRANSPORT=''
unset CLOUD_PAGES_TEST
npm --prefix frontend run build:pages
npm --prefix frontend run test:pages -- --trace retain-on-failure
