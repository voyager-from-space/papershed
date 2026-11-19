// Metadata scrubbing for PDFs whose Info dictionary or XMP packet cannot be blanked in place (compressed object streams,
// compressed XMP). Uses pdf-lib 1.17.1 (MIT, vendored in vendor/pdf-lib.min.js) to read the file, drop the Info dictionary
// and every /Metadata stream, and write the file out again. The old objects are not carried over, so the removed text is
// gone from the bytes, not hidden behind a new cross-reference section. Loaded on demand: most papers never need it.

let loading = null;
export function loadPdfLib() {
  if (globalThis.PDFLib) return Promise.resolve(globalThis.PDFLib);
  if (!loading) loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('vendor/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => resolve(globalThis.PDFLib);
    s.onerror = () => { loading = null; reject(new Error('could not load the PDF library')); };
    document.head.append(s);
  });
  return loading;
}

const text = (o) => { try { return o && o.decodeText ? o.decodeText() : o && o.asString ? o.asString() : ''; } catch { return ''; } };

// bytes: Uint8Array. Returns { bytes, found: { keys, xmp } } or { error }.
export async function deepScrubPdf(bytes, lib) {
  try { return await scrub(bytes, lib); } catch { return { error: 'the PDF library could not process it' }; }
}

async function scrub(bytes, lib) {
  const { PDFDocument, PDFName, PDFDict, PDFRef, PDFStream } = lib || (await loadPdfLib());
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false }); }
  catch (e) { return { error: /encrypt/i.test(String(e && e.message)) ? 'the PDF is encrypted' : 'the PDF library could not read it' }; }
  const pages = doc.getPageCount();
  if (!pages) return { error: 'no pages could be read from it' };
  const ctx = doc.context, found = { keys: [], xmp: false };
  const infoRef = ctx.trailerInfo.Info;
  const info = infoRef ? ctx.lookupMaybe(infoRef, PDFDict) : null;
  if (info) {
    for (const [k, v] of info.entries()) { const val = text(ctx.lookup(v)); if (val && val.trim()) found.keys.push(k.decodeText ? k.decodeText() : String(k).replace(/^\//, '')); }
    if (infoRef instanceof PDFRef) ctx.delete(infoRef);
  }
  ctx.trailerInfo.Info = undefined;
  const META = PDFName.of('Metadata'), todo = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (d && d.has(META)) todo.push([d, d.get(META)]);
  }
  for (const [d, m] of todo) { d.delete(META); if (m instanceof PDFRef) ctx.delete(m); found.xmp = true; }
  const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  // read the result back: no Info dictionary and no /Metadata anywhere, or the original bytes stay as they were
  try {
    const back = await PDFDocument.load(out, { updateMetadata: false, throwOnInvalidObject: false });
    if (back.getPageCount() !== pages || back.context.trailerInfo.Info) return { error: 'the check after scrubbing failed' };
    for (const [, obj] of back.context.enumerateIndirectObjects()) { const d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null; if (d && d.has(META)) return { error: 'the check after scrubbing failed' }; }
  } catch { return { error: 'the check after scrubbing failed' }; }
  if (!found.keys.length && !found.xmp) return { bytes: null, found }; // nothing to remove: keep the original bytes
  return { bytes: out, found: { keys: [...new Set(found.keys.map((k) => k.replace(/^\//, '')))], xmp: found.xmp } };
}
