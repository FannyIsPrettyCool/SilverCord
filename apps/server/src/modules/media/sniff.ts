/** Content sniffing from leading bytes; the client's MIME and filename are never trusted. */
export type Sniffed =
  | { readonly kind: 'image'; readonly format: 'jpeg' | 'png' | 'gif' | 'webp' }
  | { readonly kind: 'video'; readonly format: 'mp4' | 'webm' }
  /** Download-only bytes served as application/octet-stream. */
  | { readonly kind: 'file' }
  /** Markup, executables and archives are refused outright rather than parsed. */
  | { readonly kind: 'rejected' };

export const SNIFF_BYTES = 512;

const starts = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes: Uint8Array, text: string, offset = 0) =>
  starts(
    bytes,
    [...text].map((char) => char.charCodeAt(0)),
    offset,
  );

const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
]);

const REJECTED_SIGNATURES: readonly (readonly number[])[] = [
  [0x4d, 0x5a], // PE (MZ)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0xfe, 0xed, 0xfa, 0xce],
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0x50, 0x4b, 0x03, 0x04], // zip (and zip-based archives)
  [0x50, 0x4b, 0x05, 0x06],
  [0x52, 0x61, 0x72, 0x21], // rar
  [0x37, 0x7a, 0xbc, 0xaf], // 7z
  [0x1f, 0x8b], // gzip
  [0x42, 0x5a, 0x68], // bzip2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a], // xz
  [0x23, 0x21], // #! script
];

/** Leading markup (`<`, after an optional BOM and whitespace) covers SVG, HTML and XML. */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  let index = starts(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  // UTF-16 markup: a BOM followed by '<' in either byte order.
  if (starts(bytes, [0xff, 0xfe, 0x3c, 0x00]) || starts(bytes, [0xfe, 0xff, 0x00, 0x3c]))
    return true;
  while (index < bytes.length && [0x09, 0x0a, 0x0d, 0x20].includes(bytes[index] ?? -1)) index += 1;
  return bytes[index] === 0x3c;
}

export function sniff(bytes: Uint8Array): Sniffed {
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', format: 'jpeg' };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: 'image', format: 'png' };
  if (ascii(bytes, 'GIF87a') || ascii(bytes, 'GIF89a')) return { kind: 'image', format: 'gif' };
  if (ascii(bytes, 'RIFF') && ascii(bytes, 'WEBP', 8)) return { kind: 'image', format: 'webp' };
  if (ascii(bytes, 'ftyp', 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    return MP4_BRANDS.has(brand) ? { kind: 'video', format: 'mp4' } : { kind: 'file' };
  }
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = String.fromCharCode(...bytes.slice(0, 64));
    return head.includes('webm') ? { kind: 'video', format: 'webm' } : { kind: 'file' };
  }
  if (REJECTED_SIGNATURES.some((signature) => starts(bytes, signature)))
    return { kind: 'rejected' };
  if (looksLikeMarkup(bytes)) return { kind: 'rejected' };
  return { kind: 'file' };
}

export const MIME_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
} as const;
