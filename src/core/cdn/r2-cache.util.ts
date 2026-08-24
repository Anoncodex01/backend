/** Cache-Control values applied on R2 upload (Cloudflare edge respects these). */
export function cacheControlForR2Key(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.ts')) {
    return 'public, max-age=31536000, immutable';
  }
  if (lower.endsWith('.m3u8')) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }
  if (/\.(jpg|jpeg|webp|png|gif)$/i.test(lower)) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }
  if (lower.endsWith('.mp4')) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }
  return 'public, max-age=86400';
}
