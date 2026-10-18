export const MAX_URL_LENGTH = 2048;

/**
 * Returns a normalized absolute http(s) URL, or null. Embedded credentials are refused because
 * `https://bank.example@evil.example` reads as the wrong host.
 */
export function safeLinkUrl(raw: string): string | null {
  if (raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url.href;
}
