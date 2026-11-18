---
name: verify-papershed
description: Prove the papershed static page (site/) works, locally or on its GitHub Pages URL, by running only its acceptance checks in headless Chrome. Use after any change to site/ or the fixture, and before every push.
---

# verify papershed

The only surface is the browser page. There is no server code.

## Run

1. Fixture (only after editing `scripts/make-fixtures.py`): `python3 scripts/make-fixtures.py`.
2. Local: `node scripts/verify.mjs`. It serves `site/` with `python3 -m http.server 4182 --bind 127.0.0.1`, runs the checks and stops the server. Playwright is linked into `node_modules/`; Chrome is `/opt/google/chrome/chrome` (override with `CHROME=`).
3. Live: `BASE_URL=https://voyager-from-space.github.io/papershed/ SHOTS=screenshots/live node scripts/verify.mjs`.

Exit 0 and a final `N/N passed` line means green.

## Acceptance checks (and nothing else)

- (a) the page loads and the title contains "papershed".
- (b) a real `#file` upload of `test/fixtures/sample-paper.zip` shows `#results`, with the measured input size in `#res-title`.
- (c) `#download` saves a zip whose size matches the page. Unzipped: none of the planted comment strings, no comment env or `\iffalse` content; `\%`, verbatim and lstlisting `%` and the line-joining `%` survive; unused files (old-draft.tex, refs-old.bib, unused-photo.jpg, scratch.png, notes.txt, main.pdf) are gone; used files are present; junk (`.aux`, `.log`, `__MACOSX`, `.DS_Store`...) is gone; the JPEG has no APP1/EXIF and is capped at 2000 px; the PNG has no tEXt/iTXt/zTXt/eXIf; PDF author strings are blank; CLEAN-REPORT.txt has no secret values; the same upload gives the same sha256.
- (d) `#leaks li[data-rule]` include `password`, `aws-key`, at least 2 `cloud-link` and `gps` (field-site.jpg); secret values never appear in full on the page; the copy says the scan is a heuristic.
- (e) at 390×844 the page has no horizontal overflow before and after a result.
- (f) `scripts/check-identity.sh` has 0 hits, and a denylist grep over the served HTML, JS, CSS and sample zip has 0 hits.

Also counted: no console errors, no requests outside the site, the "Try a sample paper" button works.

## Evidence

Screenshots land in `screenshots/local/` or `screenshots/live/`: `desktop-start`, `desktop-result`, `desktop-result-full`, `mobile-start`, `mobile-result`. Open each before sharing and reject any that shows a real username, path, browser tab, email or notification. Downloads land in `test/out/`.

Never call `cleanProject()` directly in place of the page: upload through the real input.
