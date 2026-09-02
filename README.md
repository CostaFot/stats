# stats

Daily install numbers for my Command Palette extensions, recorded by GitHub
Actions onto this repo's `data` branch. The dashboard that draws them lives on
[costafotiadis.com/stats](https://www.costafotiadis.com/stats/); its source is
in [the site repo](https://github.com/CostaFot/costafotiadis.com/blob/main/src/pages/stats.astro).

## How it works

```
GitHub Actions (daily, 05:23 UTC)
  record-stats.yml
    └─ Collect-Stats.ps1
         ├─ gh api <repo>/releases            GitHub + WinGet downloads
         ├─ Get-StoreStats.ps1                Microsoft Store acquisitions
         └─ upsert data/<slug>.csv
              └─ commit to orphan `data` branch
```

- **`data` branch** (orphan): one CSV per app, schema
  `date,github_downloads,store_acquisitions`, both cumulative. A blank cell
  means "not recorded that day" (backfilled Store history has no GitHub
  column); readers should forward-fill.
- **`main`**: the collector. Daily data commits never touch it.
- Read the CSVs at
  `https://raw.githubusercontent.com/CostaFot/stats/refs/heads/data/data/<slug>.csv`.
  The URL spells out `refs/heads/data` on purpose: the short form leaves GitHub
  guessing where the ref ends, and it returns 400 for some files (seen with
  `market.csv`, Aug 2026).
- **`apps.json`** is the app list (slug, name, repo, storeId). The site keeps
  its own copy for the dashboard.

## Secrets

The workflow needs three repo secrets for the Microsoft Store analytics API
(Entra app registration associated with the Partner Center account; one set of
credentials covers every app, `applicationId` selects which):

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

1. Add an entry to `apps.json` (slug, name, repo, storeId).
2. Add the same entry to `src/data/stats-apps.json` in the site repo.
3. The next daily run creates `data/<slug>.csv` and the dashboard picks it up.

## Local run

```powershell
./scripts/Collect-Stats.ps1 -DataDir ./_data   # dry run, writes local CSVs
```

`scripts/Backfill.ps1` was the one-off seeding of the `data` branch: it copied
AdbExtension's recorded history verbatim and rebuilt cumulative Store history
for the other apps from the analytics API's daily rows.
