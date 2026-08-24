#!/usr/bin/env node
/**
 * Backfill Cache-Control metadata on existing R2 objects so Cloudflare DAR
 * can cache HLS segments, posters, and MP4 at the edge.
 *
 * Usage (on VPS with R2 credentials in backend/.env):
 *   node scripts/backfill-r2-cache-headers.mjs
 *   node scripts/backfill-r2-cache-headers.mjs --prefix videos/
 *   node scripts/backfill-r2-cache-headers.mjs --dry-run
 */
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

function cacheControlForKey(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith('.ts')) return 'public, max-age=31536000, immutable';
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prefixArg = args.find((a) => a.startsWith('--prefix='));
const prefix = prefixArg ? prefixArg.split('=')[1] : '';

const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET || 'whapvibez-media';

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

let updated = 0;
let scanned = 0;
let continuationToken;

do {
  const list = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
      MaxKeys: 500,
    }),
  );

  for (const obj of list.Contents || []) {
    if (!obj.Key) continue;
    scanned++;
    const cacheControl = cacheControlForKey(obj.Key);
    if (dryRun) {
      console.log(`[dry-run] ${obj.Key} -> ${cacheControl}`);
      updated++;
      continue;
    }

    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: obj.Key,
        CopySource: `${bucket}/${encodeURIComponent(obj.Key).replace(/%2F/g, '/')}`,
        MetadataDirective: 'REPLACE',
        CacheControl: cacheControl,
      }),
    );
    updated++;
    if (updated % 50 === 0) {
      console.log(`Updated ${updated} objects...`);
    }
  }

  continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
} while (continuationToken);

console.log(`Done. Scanned ${scanned}, updated ${updated}${dryRun ? ' (dry-run)' : ''}.`);
