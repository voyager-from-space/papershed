// Browser-only downscaler, adapted from texdiet's shrinkImage. Keeps the format (PNG stays PNG, JPEG stays JPEG)
// so no \includegraphics line has to change. Re-encoding through a canvas also drops any metadata left.
const MAX_SIDE = 2000;      // about 6.7 in wide at 300 dpi
const JPEG_QUALITY = 0.85;

export function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20), kind: 'png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], kind: 'jpeg' };
      i += 2 + len;
    }
  }
  return null;
}

const blobOf = (c, type, q) => (c.convertToBlob ? c.convertToBlob({ type, quality: q }) : new Promise((r) => c.toBlob(r, type, q)));

// returns { bytes, w, h, from } when a smaller, capped copy exists; null otherwise
export async function shrink(file) {
  const dim = imageSize(file.bytes);
  if (!dim || Math.max(dim.w, dim.h) <= MAX_SIDE) return null;
  const scale = MAX_SIDE / Math.max(dim.w, dim.h);
  const w = Math.max(1, Math.round(dim.w * scale)), h = Math.max(1, Math.round(dim.h * scale));
  const bmp = await createImageBitmap(new Blob([file.bytes]), { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  const type = dim.kind === 'png' ? 'image/png' : 'image/jpeg';
  const bytes = new Uint8Array(await (await blobOf(canvas, type, JPEG_QUALITY)).arrayBuffer());
  return bytes.length < file.bytes.length ? { bytes, w, h, from: dim } : null;
}
