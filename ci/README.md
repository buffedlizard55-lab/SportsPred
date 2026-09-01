# GitHub Actions workflows — one manual step required

These two workflows are complete and ready, but they live here rather than in
`.github/workflows/` because the automation account used to build this
repository does not have the `workflows` permission that GitHub requires to
create or update them. The push was rejected with:

> refusing to allow a GitHub App to create or update workflow
> `.github/workflows/collect.yml` without `workflows` permission

To enable them, run once from a checkout made with your own credentials:

```bash
mkdir -p .github/workflows
cp ci/pages.yml ci/collect.yml .github/workflows/
git add .github/workflows
git commit -m "ci: enable Pages deploy and scheduled collection"
git push
```

Then, in the repository settings, set **Settings → Pages → Build and
deployment → Source** to **GitHub Actions**.

Alternatively, grant the app the `workflows` permission under
**Settings → Actions → General → Workflow permissions** and the files can be
pushed from here instead.

## What each workflow does

### `pages.yml`
Runs on push to `main` and on demand. Runs the full test suite (112 Node,
23 Python), then assembles a clean artifact containing only `index.html`,
`assets/`, `engine/` and `data/` and publishes it. Scripts, tests and captured
HTML fixtures are deliberately excluded from the public site.

> **Current exposure, verified 2026-08-31:** Pages is deployed in **legacy
> mode** from `main`/`/` (`gh api repos/{owner}/{repo}/pages` reports
> `build_type: legacy`), so until `pages.yml` is installed *and* the Pages
> source is switched to GitHub Actions, everything at the repository root —
> including `scripts/`, `tests/` and `docs/` — is publicly reachable at
> https://buffedlizard55-lab.github.io/SportsPred/. Nothing sensitive is in
> those paths, but the exclusion claim above only becomes true after the
> switch.

### `collect.yml`
Runs every 30 minutes and on demand. Runs tests, collects the OLBG slate with
`--save-html` (so the reconstructed parser fixture can be replaced with a real
capture — see `IR-03`), enriches up to 25 event pages for their market lists,
records predictions for forward grading, prints the backtest report, and commits
only if `data/` actually changed.

A failed collection does **not** clobber existing data: `collect_olbg.py` aborts
without writing when nothing could be fetched, and the workflow reports the
failure as a warning rather than overwriting the last good snapshot.
