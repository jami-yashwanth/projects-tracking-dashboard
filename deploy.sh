#!/bin/bash
# Scan ~/Projects, build the page and publish it to Cloudflare Pages.
# Run by hand, or every day at 12:00 by launchd/com.jamiyashwanth.projects-dashboard.plist.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

PROJECT="projects-tracking-dashboard"
NAMESPACE_ID="$(sed -n 's/^id *= *"\(.*\)"/\1/p' wrangler.toml | head -1)"
mkdir -p data logs
echo "== $(date '+%Y-%m-%d %H:%M') deploy"

# Projects you stopped tracking on the site, so the scan skips them. Missing or unreadable: track everything.
if npx --yes wrangler kv key get "doc:board/hidden" --namespace-id "$NAMESPACE_ID" --remote > data/untracked.tmp 2>/dev/null \
   && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' data/untracked.tmp 2>/dev/null; then
  mv data/untracked.tmp data/untracked.json
else
  rm -f data/untracked.tmp
  echo '{"items": []}' > data/untracked.json
fi

python3 scanner/scan.py "$HOME/Projects" data/projects.json
python3 build.py
npx --yes wrangler pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true
