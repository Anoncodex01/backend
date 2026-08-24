const R2_CDN_HOST = 'cdn.whapvibez.com';

export { cacheControlForR2Key } from '../../core/cdn/r2-cache.util';

function isCdnUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes(R2_CDN_HOST);
  } catch {
    return url.includes(R2_CDN_HOST);
  }
}

function addUrl(urls: Set<string>, raw?: string | null) {
  const trimmed = raw?.trim();
  if (!trimmed || !trimmed.startsWith('http')) return;
  urls.add(trimmed);
}

function lowStartHlsUrl(masterOrPlaylistUrl: string): string {
  const trimmed = masterOrPlaylistUrl.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes('360p')) return trimmed;
  if (lower.endsWith('master.m3u8')) {
    return `${trimmed.slice(0, -'master.m3u8'.length)}360p/playlist.m3u8`;
  }
  if (lower.endsWith('/playlist.m3u8') && !lower.includes('/360p/')) {
    const base = trimmed.slice(0, -'playlist.m3u8'.length);
    return `${base}360p/playlist.m3u8`;
  }
  return trimmed;
}

/**
 * Collect CDN URLs to prefetch at the edge (posters + HLS entry + faststart MP4).
 */
export function collectReelsPrefetchUrls(
  posts: any[],
  maxPosts = 8,
): string[] {
  const urls = new Set<string>();

  for (const post of posts.slice(0, maxPosts)) {
    const videoUrl = post?.video_url?.toString().trim();
    const faststart = post?.faststart_url?.toString().trim();
    const thumb =
      post?.video_thumbnail_url?.toString().trim() ||
      post?.thumbnail_url?.toString().trim();

    addUrl(urls, thumb);
    addUrl(urls, faststart);

    if (videoUrl) {
      addUrl(urls, videoUrl);
      if (videoUrl.toLowerCase().includes('.m3u8') && isCdnUrl(videoUrl)) {
        addUrl(urls, lowStartHlsUrl(videoUrl));
      }
    }

    const postId = post?.id?.toString();
    if (postId && !thumb) {
      addUrl(urls, `https://${R2_CDN_HOST}/thumbnails/${postId}.jpg`);
    }
  }

  return [...urls];
}

function resolvePlaylistUrl(baseUrl: string, line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const base = new URL(baseUrl);
  if (trimmed.startsWith('/')) {
    return `${base.origin}${trimmed}`;
  }
  const dir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  return `${dir}${trimmed}`;
}

/**
 * Expand an HLS playlist into segment URLs worth warming at Cloudflare DAR.
 */
export async function expandHlsWarmUrls(
  playlistUrl: string,
  fetchFn: (url: string) => Promise<string>,
  maxSegments = 2,
): Promise<string[]> {
  const out = new Set<string>([playlistUrl]);

  let body: string;
  try {
    body = await fetchFn(playlistUrl);
  } catch {
    return [...out];
  }

  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));

  if (isMaster) {
    const variantLines = lines.filter(
      (l) => !l.startsWith('#') && l.endsWith('.m3u8'),
    );
    const variant =
      variantLines.find((l) => l.includes('360p')) || variantLines[0];
    if (variant) {
      const variantUrl = resolvePlaylistUrl(playlistUrl, variant);
      out.add(variantUrl);
      const nested = await expandHlsWarmUrls(variantUrl, fetchFn, maxSegments);
      nested.forEach((u) => out.add(u));
    }
    return [...out];
  }

  const segments = lines.filter(
    (l) => !l.startsWith('#') && (l.endsWith('.ts') || l.includes('.ts?')),
  );
  for (const seg of segments.slice(0, maxSegments)) {
    out.add(resolvePlaylistUrl(playlistUrl, seg));
  }

  return [...out];
}
