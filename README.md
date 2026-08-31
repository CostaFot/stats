# stats

Single dashboard for install stats across all of my Command Palette extensions,
hosted on Railway. Data is recorded daily by GitHub Actions; the page reads it
straight from this repo, so it needs no redeploys to stay current.

## How it works

```
GitHub Actions (daily, 05:23 UTC)          Railway (static site)
  record-stats.yml                           server.js serves site/
    └─ Collect-Stats.ps1                       └─ app.js fetches
         ├─ gh api <repo>/releases                raw.githubusercontent.com/CostaFot/
         ├─ Get-StoreStats.ps1 (Store API)        stats/refs/heads/data/data/<slug>.csv
         └─ upsert data/<slug>.csv                at runtime (CORS is open there)
              └─ commit to orphan `data` branch
```

- **`data` branch** (orphan): one CSV per app, schema
  `date,github_downloads,store_acquisitions` — both cumulative. A blank cell
  means "not recorded that day" (e.g. backfilled Store history has no GitHub
  column); the dashboard forward-fills.
- **`main`**: everything else. Railway deploys from here; daily data commits
  never touch it.
- The raw URLs spell out `refs/heads/data` on purpose: the short form
  (`/stats/data/data/<slug>.csv`) leaves GitHub guessing where the ref ends,
  and it returns 400 for some files (seen with `market.csv`, Aug 2026).
- **`site/apps.json`** is the single source of truth for the app list — read by
  the collector in CI and fetched by the dashboard.

## Secrets

The workflow needs three repo secrets for the Microsoft Store analytics API
(Entra app registration associated with the Partner Center account — one set of
credentials covers every app; `applicationId` selects which):

- `STORE_TENANT_ID`, `STORE_CLIENT_ID`, `STORE_CLIENT_SECRET`

The tenant ID is also listed under Partner Center **Account settings → Tenants**,
which doubles as a sanity check that the Entra association is actually in place.

For local runs, put the same three as `KEY=value` lines in a git-ignored `.env`
at the repo root. Without them, collection still records the GitHub numbers and
leaves the Store column blank.

> **Rotation:** Entra client secrets expire (max 24 months). When Store columns
> go blank and the workflow logs an auth warning, create a new key in Partner
> Center: **Account settings → User management → Microsoft Entra applications →
> "adb stats reader" → Add new key** (or via the Entra portal: App registrations
> → the app → Certificates & secrets). Then re-set only `STORE_CLIENT_SECRET`:
> `gh secret set STORE_CLIENT_SECRET -R CostaFot/stats`.

## Adding an app

1. Add an entry to `site/apps.json` (slug, name, repo, storeId).
2. That's it — the next daily run creates `data/<slug>.csv`, and the dashboard
   picks it up. (With more than 4 apps, add a `--series-5` color in
   `site/index.html`.)

## Local development

```powershell
./scripts/Collect-Stats.ps1 -DataDir ./_data   # dry run, writes local CSVs
node server.js                                  # http://localhost:3000
```

`scripts/Backfill.ps1` was the one-off seeding of the `data` branch: it copied
AdbExtension's recorded history verbatim and rebuilt cumulative Store history
for the other apps from the analytics API's daily rows.
