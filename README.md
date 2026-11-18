# papershed

Clean a LaTeX source zip before you post it, for example to arXiv. Drop the zip in the page and get a cleaned upload zip back, plus a report of what was removed and what looked like a leak. It runs in your browser tab. Nothing is uploaded, and there is no account.

Live: https://voyager-from-space.github.io/papershed/

## What it does

- **Strips comments** from `.tex` files: `%` comments (an escaped `\%` stays; `verbatim`, `lstlisting`, `minted` and similar environments are left alone), `\begin{comment}...\end{comment}` and `\iffalse...\fi` blocks. A line that ends in a comment keeps a bare `%`, so line joins don't change.
- **Drops files the paper never uses.** It finds the file with `\documentclass` and follows `\input`, `\include`, `\subfile`, `\import`, `\includegraphics` (with or without extension, with `\graphicspath`), `\includepdf`, `\bibliography`/`\addbibresource`, `\bibliographystyle` and local `.sty`/`.cls` files. `.bbl` files are always kept. Build output and system junk (`.aux`, `.log`, `.synctex.gz`, `__MACOSX`, `.DS_Store`, `.git` and so on) goes too. If a figure path is built from a macro it can't follow, every figure is kept.
- **Removes image metadata.** EXIF, XMP and IPTC from JPEGs (the report says which photos had a GPS position), and `tEXt`/`iTXt`/`zTXt`/`eXIf` chunks from PNGs. Images longer than 2000 px on a side are downscaled in the same format.
- **Blanks PDF figure metadata** (Info `Author`, `Creator`, `Producer`, `Title`, `Subject`, `Keywords` and the XMP packet) in place when it is stored uncompressed. Compressed metadata is reported, not touched.
- **Flags possible leaks** in every text file, including text inside the comments it removed: passwords, API keys and tokens, private key blocks, private cloud links (Google Drive/Docs, Dropbox, Overleaf project links, OneDrive...), email addresses and `\todo` leftovers. This scan is a heuristic. It matches patterns, so it can miss a secret and it can flag harmless text. Values are masked in the report.
- **Writes a deterministic zip** (sorted entries, fixed timestamps) with a `CLEAN-REPORT.txt` that lists file names and counts only. Delete it before you upload if you don't want it in the bundle.

It does not compile your project. Check that the cleaned zip still builds before you submit it.

## Credits

The cleaning rules were inspired by google-research's [arxiv-latex-cleaner](https://github.com/google-research/arxiv-latex-cleaner), a Python CLI. papershed is a separate implementation in JavaScript; no code was copied from it. papershed is not affiliated with arXiv.

The zip ingest, image downscaler and verify harness started from [texdiet](https://github.com/voyager-from-space/texdiet).

## Develop

Static files in `site/`, no build step.

- `python3 -m http.server 4182 --directory site` to serve it.
- `python3 scripts/make-fixtures.py` rebuilds `test/fixtures/sample-paper.zip` (also the in-app sample). Every secret, link and name in it is invented; `AKIAIOSFODNN7EXAMPLE` is the example key from AWS's docs.
- `node scripts/verify.mjs` runs the acceptance checks in headless Chrome (needs Playwright). `BASE_URL=<url> node scripts/verify.mjs` checks a deployed copy.
- `sh scripts/check-identity.sh` greps the tree against a local, untracked denylist.

## Licences

papershed is MIT. Bundled: JSZip (dual MIT or GPLv3, used here under MIT; see `site/vendor/jszip-LICENSE.md`) and IBM Plex Sans/Mono (SIL Open Font License 1.1, see `site/fonts/OFL.txt`).
