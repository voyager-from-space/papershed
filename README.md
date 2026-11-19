# papershed

Clean a LaTeX source zip before you post it, for example to arXiv. Drop the zip in the page and get a cleaned upload zip back, plus a report of what was removed and what looked like a leak. It runs in your browser tab. Nothing is uploaded, and there is no account.

Live: https://voyager-from-space.github.io/papershed/

## What it does

- **Strips comments** from `.tex` files: `%` comments (an escaped `\%` stays; `verbatim`, `lstlisting`, `minted` and similar environments are left alone), `\begin{comment}...\end{comment}` and `\iffalse...\fi` blocks. A line that ends in a comment keeps a bare `%`, so line joins don't change.
- **Drops files the paper never uses.** It finds the file with `\documentclass` and follows `\input`, `\include`, `\subfile`, `\import`, `\includegraphics` (with or without extension, with `\graphicspath`), `\includepdf`, `\bibliography`/`\addbibresource`, `\bibliographystyle` and local `.sty`/`.cls` files. `.bbl` files are always kept. Build output and system junk (`.aux`, `.log`, `.synctex.gz`, `__MACOSX`, `.DS_Store`, `.git` and so on) goes too. If a figure path is built from a macro it can't follow, every figure is kept.
- **Removes image metadata.** EXIF, XMP and IPTC from JPEGs (the report says which photos had a GPS position), and `tEXt`/`iTXt`/`zTXt`/`eXIf` chunks from PNGs. Images longer than 2000 px on a side are downscaled in the same format.
- **Removes PDF figure metadata.** Info `Author`, `Creator`, `Producer`, `Title`, `Subject`, `Keywords` and the XMP packet are blanked in place when they are stored plainly. When they sit in compressed object streams or a compressed XMP packet (what pdfTeX, Word and most exporters write), papershed loads [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) on demand, drops the Info dictionary and every `/Metadata` stream, writes the file out again, and reads the result back to check. The removed text is gone from the bytes. If a PDF can't be read (encrypted or damaged), the report says so and leaves it as it was.
- **Flags possible leaks** in every text file, including text inside the comments it removed: passwords, API keys and tokens, private key blocks, private cloud links (Google Drive/Docs, Dropbox, Overleaf project links, OneDrive...), email addresses and `\todo` leftovers. This scan is a heuristic. It matches patterns, so it can miss a secret and it can flag harmless text. Values are masked in the report.
- **Checks the abstract against arXiv's rules** (the [metadata page](https://info.arxiv.org/help/prep.html)). It finds `\begin{abstract}` or `\abstract{...}` in the kept files and reports the length against arXiv's 1,920 characters, non-ASCII characters (arXiv's form rejects them, and the report names each one with the TeX form from arXiv's table), a leading "Abstract", `~`, `\,` and `\ `, font commands, indented lines and blank lines. Citations and your own macros are listed as a papershed note, because they are not an arXiv rule. You can also paste the text you will type into the form. arXiv doesn't publish exactly how it counts, so the page says to keep a margin.
- **Checks the size against arXiv's limits.** arXiv's [support page](https://arxiv-org.atlassian.net/wiki/spaces/AUS/pages/13041666/What+to+do+if+my+submission+is+Oversized) (dated 26 March 2021) says "The current submission size limit is 50MB" and suggests 2 MB or less per file. The [oversized-submissions page](https://info.arxiv.org/help/sizes.html) says arXiv warns about images above 34 megapixels. arXiv doesn't say whether the 50 MB counts the zip or the unpacked files, or whether MB is 10^6 or 2^20 bytes, so papershed checks both sizes against 50,000,000 bytes and prints exact byte counts. It does not invent any other limit.
- **Compiles the cleaned project in the tab** when you press "Check that it builds". It picks the main file, the engine (pdfLaTeX, XeLaTeX or LuaLaTeX) and the bibliography plan, builds with [BusyTeX](https://github.com/busytex/busytex) (TeX Live as WebAssembly) in a Web Worker and shows pages, errors and warnings, with the built PDF to open. If it fails, it builds your original zip too and says whether cleaning caused the failure. The engine and TeX Live data are loaded on demand from the [maketitle-assets](https://github.com/voyager-from-space/maketitle-assets) GitHub Pages site, so the cleaning flow stays fast. The first check downloads about 177 MB (about 440 MB when the paper needs the larger package set) and the browser keeps it for next time. Nothing you drop is uploaded.
- **Writes a deterministic zip** (sorted entries, fixed timestamps) with a `CLEAN-REPORT.txt` that lists file names and counts only. Delete it before you upload if you don't want it in the bundle.

The compile check builds in a recent TeX Live; arXiv uses its own installation, so a passing build is good evidence, not a guarantee. The reference graph can miss a file that only a custom command reads (for example a data file opened with `\openin`); the compile check is there to catch that.

## Credits

The cleaning rules were inspired by google-research's [arxiv-latex-cleaner](https://github.com/google-research/arxiv-latex-cleaner), a Python CLI. papershed is a separate implementation in JavaScript; no code was copied from it. papershed is not affiliated with arXiv.

The compile check reuses the engine and assets setup of [maketitle](https://github.com/voyager-from-space/maketitle). The zip ingest, image downscaler and verify harness started from [texdiet](https://github.com/voyager-from-space/texdiet).

## Develop

Static files in `site/`, no build step. `site/compile.js` and the PDF library load only when needed.

- `python3 -m http.server 4182 --directory site` to serve it.
- `python3 scripts/make-fixtures.py` rebuilds `test/fixtures/sample-paper.zip` (also the in-app sample). Every secret, link and name in it is invented; `AKIAIOSFODNN7EXAMPLE` is the example key from AWS's docs.
- `node --test test/*.test.mjs` runs the unit tests for the arXiv rules and the PDF scrubber (the PDF tests need `python3` and poppler's `pdfinfo`).
- `node scripts/verify.mjs` runs the acceptance checks in headless Chrome (needs Playwright, poppler-utils and the maketitle-assets repo cloned next to this one for the local compile check; `ASSETS_DIR` overrides the path). `BASE_URL=<url> node scripts/verify.mjs` checks a deployed copy and downloads TeX Live from GitHub Pages.
- `python3 scripts/make-test-zips.py` builds the extra zips verify uploads (a 52 MB zip, a 36-megapixel PNG, a project cleaning breaks, a project that never builds).
- `sh scripts/check-identity.sh` greps the tree against a local, untracked denylist.

## Licences

papershed is MIT. Bundled: JSZip (dual MIT or GPLv3, used here under MIT; see `site/vendor/jszip-LICENSE.md`), pdf-lib 1.17.1 (MIT, with pako, tslib and others, see `site/vendor/pdf-lib-LICENSES.md`) and IBM Plex Sans/Mono (SIL Open Font License 1.1, see `site/fonts/OFL.txt`).

Not bundled: the compile check loads BusyTeX and TeX Live from maketitle-assets at run time. BusyTeX is AGPL-3.0 and TeX Live packages keep their own licences; none of that code is in this repo. The worker shim it uses (`core/worker-shim.js` in maketitle-assets) is ours, AGPL-3.0-or-later like that repo.
