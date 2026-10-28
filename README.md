# Projects tracking dashboard

One private page for every project in `~/Projects`: what's active, what's gone quiet, the main stack, the outside
services and domains each one uses (with links to their dashboards), recent commits, and an inbox for ideas.

It runs on a free Cloudflare account and a scheduled job on a Mac. Nothing depends on any paid plan.

## How it works

```
~/Projects ──scanner/scan.py──> data/projects.json ──build.py──> dist/index.html ──wrangler──> Cloudflare Pages
                                                                                      functions/api  <── ideas, pins,
                                                                                      (KV storage)       untracked list
```

- **scanner/scan.py** reads each project's code, git history, `.env` variable *names* (never values), DNS and
  whois. Services you add by hand go in the project's `PROJECT.md` under `## Accounts`.
- **site/** is the page: design, script and brand marks (from [Simple Icons](https://simpleicons.org), CC0).
- **functions/api/** stores ideas, pins and the untracked list in Cloudflare KV.
- **Cloudflare Access** lets only one email open the site. The API also checks that email, so it refuses any request
  that didn't come through Access.
- **deploy.sh** runs the scan, builds and deploys. **launchd/** runs it every day at 12:00.

`data/` and `dist/` are git-ignored: they contain your real project details and only ever go to the private site.

## Run it

```bash
./deploy.sh
```

## Set up on a new Mac

1. `npx wrangler login`
2. Check `wrangler.toml` has your KV namespace id, and set the allowed email:
   `npx wrangler pages secret put ALLOWED_EMAIL --project-name projects-tracking-dashboard`
3. In the Cloudflare dashboard, put an Access application in front of the site that allows only that email.
4. Install the daily job:
   ```bash
   cp launchd/com.jamiyashwanth.projects-dashboard.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.jamiyashwanth.projects-dashboard.plist
   ```
