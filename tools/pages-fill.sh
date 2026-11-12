#!/usr/bin/env bash
# Fills the placeholders in the assembled Pages site (pages.yml and the altstore
# job in release.yml both deploy it). Values come from repository variables;
# locally they are in .env.
#   tools/pages-fill.sh <site dir>
set -euo pipefail
dir="${1:?site dir}"
: "${CHROME_WEBSTORE_URL:?set the CHROME_WEBSTORE_URL repository variable}"

: "${TESTERS_GROUP_URL:?set the TESTERS_GROUP_URL repository variable (the Google Group that is the Play tester list)}"

grep -rlZ '__CHROME_WEBSTORE_URL__' "$dir" | xargs -0 -r sed -i "s#__CHROME_WEBSTORE_URL__#${CHROME_WEBSTORE_URL}#g"
grep -rlZ '__TESTERS_GROUP_URL__' "$dir" | xargs -0 -r sed -i "s#__TESTERS_GROUP_URL__#${TESTERS_GROUP_URL}#g"

if grep -rn '__[A-Z_]*_URL__' "$dir"; then
  echo "unfilled placeholder in $dir" >&2
  exit 1
fi
