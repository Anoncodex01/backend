import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { MediaService } from './media.service';
import { MigrationService } from './migration.service';
import { FeedService } from '../feed/feed.service';

const execFileAsync = promisify(execFile);

export type ScriptRisk = 'low' | 'medium' | 'high';
export type ScriptType = 'shell' | 'internal';

export interface AdminScriptDefinition {
  id: string;
  label: string;
  description: string;
  type: ScriptType;
  risk: ScriptRisk;
  relativePath?: string;
  internalAction?: string;
}

export interface DiscoveredScript {
  id: string;
  label: string;
  description: string;
  type: ScriptType;
  risk: ScriptRisk;
  relativePath: string;
  runnable: boolean;
  exists: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
}

const SCRIPT_REGISTRY: AdminScriptDefinition[] = [
  {
    id: 'apply-r2-cors',
    label: 'Apply R2 CORS',
    description: 'Applies HLS CORS policy to the R2 bucket (requires wrangler on server).',
    type: 'shell',
    risk: 'low',
    relativePath: 'scripts/apply-r2-cors.sh',
  },
  {
    id: 'nginx-reload',
    label: 'Reload nginx',
    description: 'Validates and reloads nginx inside the whapvibez-nginx container.',
    type: 'shell',
    risk: 'medium',
    relativePath: 'update_and_reload.sh',
  },
  {
    id: 'check-payment-logs',
    label: 'Check payment logs',
    description: 'Prints recent payment-related log lines from the API container.',
    type: 'shell',
    risk: 'low',
    relativePath: 'check_payment_logs.sh',
  },
  {
    id: 'deploy-on-vps',
    label: 'Deploy on VPS',
    description: 'Pulls latest backend and rebuilds Docker services on this server.',
    type: 'shell',
    risk: 'high',
    relativePath: 'deploy-on-vps.sh',
  },
  {
    id: 'full-deploy',
    label: 'Full deploy script',
    description: 'Runs the main deploy.sh pipeline (build, restart, health check).',
    type: 'shell',
    risk: 'high',
    relativePath: 'deploy.sh',
  },
  {
    id: 'setup-vps',
    label: 'Setup VPS',
    description: 'Initial VPS bootstrap script — only run on fresh servers.',
    type: 'shell',
    risk: 'high',
    relativePath: 'scripts/setup-vps.sh',
  },
  {
    id: 'invalidate-feed-cache',
    label: 'Invalidate feed cache',
    description: 'Clears Redis reels/trending/for-you feed caches immediately.',
    type: 'internal',
    risk: 'low',
    internalAction: 'invalidate-feed-cache',
  },
  {
    id: 'cleanup-temp-uploads',
    label: 'Cleanup temp uploads',
    description: 'Removes stale files from /tmp upload and processing directories.',
    type: 'internal',
    risk: 'low',
    internalAction: 'cleanup-temp-uploads',
  },
  {
    id: 'start-r2-migration',
    label: 'Start Stream → R2 migration',
    description: 'Queues background migration of legacy Cloudflare Stream videos to R2.',
    type: 'internal',
    risk: 'medium',
    internalAction: 'start-r2-migration',
  },
];

@Injectable()
export class MediaAdminService {
  private readonly logger = new Logger(MediaAdminService.name);
  private readonly appRoot: string;
  private readonly runHistory = new Map<string, { ranAt: string; success: boolean; output: string }>();

  constructor(
    private mediaService: MediaService,
    private migrationService: MigrationService,
    private feedService: FeedService,
  ) {
    this.appRoot = process.env.APP_ROOT || process.cwd();
  }

  async getOverview() {
    const [queueStats, failedPosts, migration] = await Promise.all([
      this.mediaService.getQueueStats(),
      this.mediaService.listFailedPosts(25),
      Promise.resolve(this.migrationService.getProgress()),
    ]);

    return {
      workerMode: process.env.VIDEO_WORKER_ONLY === '1'
        ? 'standalone-worker'
        : process.env.VIDEO_DISABLE_WORKER === '1'
          ? 'api-only'
          : 'combined',
      queue: queueStats,
      migration,
      failedPosts,
      failedCount: failedPosts.length,
    };
  }

  listScripts(): DiscoveredScript[] {
    const registryByPath = new Map(
      SCRIPT_REGISTRY.filter((s) => s.relativePath).map((s) => [s.relativePath!, s]),
    );
    const discovered = new Map<string, DiscoveredScript>();

    for (const def of SCRIPT_REGISTRY) {
      if (def.type === 'internal') {
        discovered.set(def.id, {
          id: def.id,
          label: def.label,
          description: def.description,
          type: def.type,
          risk: def.risk,
          relativePath: def.internalAction || def.id,
          runnable: true,
          exists: true,
        });
        continue;
      }

      const relativePath = def.relativePath!;
      const fullPath = path.join(this.appRoot, relativePath);
      const exists = fs.existsSync(fullPath);
      let sizeBytes: number | undefined;
      let modifiedAt: string | undefined;
      if (exists) {
        const stat = fs.statSync(fullPath);
        sizeBytes = stat.size;
        modifiedAt = stat.mtime.toISOString();
      }
      discovered.set(def.id, {
        id: def.id,
        label: def.label,
        description: def.description,
        type: def.type,
        risk: def.risk,
        relativePath,
        runnable: true,
        exists,
        sizeBytes,
        modifiedAt,
      });
    }

    const scanDirs = [
      path.join(this.appRoot, 'scripts'),
      this.appRoot,
    ];

    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.sh')) continue;
        const relativePath = dir.endsWith('scripts')
          ? path.join('scripts', entry)
          : entry;
        const normalized = relativePath.split(path.sep).join('/');
        if ([...discovered.values()].some((s) => s.relativePath === normalized)) {
          continue;
        }

        const fullPath = path.join(this.appRoot, normalized);
        const stat = fs.statSync(fullPath);
        const registry = registryByPath.get(normalized);
        discovered.set(`file:${normalized}`, {
          id: `file:${normalized}`,
          label: registry?.label || entry,
          description: registry?.description || 'Shell script found on server (view only unless whitelisted).',
          type: 'shell',
          risk: registry?.risk || 'high',
          relativePath: normalized,
          runnable: Boolean(registry),
          exists: true,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }

    return [...discovered.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  getLastRun(scriptId: string) {
    return this.runHistory.get(scriptId) || null;
  }

  async runScript(scriptId: string, confirmDangerous = false) {
    const def = SCRIPT_REGISTRY.find((s) => s.id === scriptId);
    if (!def) {
      throw new NotFoundException(`Unknown or non-runnable script: ${scriptId}`);
    }

    if (def.risk === 'high' && !confirmDangerous) {
      throw new BadRequestException(
        'This script is marked high-risk. Pass confirmDangerous=true to run it.',
      );
    }

    const startedAt = new Date().toISOString();
    try {
      let output = '';

      if (def.type === 'internal') {
        output = await this.runInternalAction(def.internalAction!);
      } else {
        const scriptPath = path.join(this.appRoot, def.relativePath!);
        if (!fs.existsSync(scriptPath)) {
          throw new NotFoundException(`Script file not found: ${def.relativePath}`);
        }
        const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
          cwd: this.appRoot,
          timeout: 5 * 60 * 1000,
          maxBuffer: 1024 * 1024,
          env: process.env,
        });
        output = [stdout, stderr].filter(Boolean).join('\n').trim();
      }

      const result = {
        scriptId,
        success: true,
        ranAt: startedAt,
        output: output.slice(0, 20_000),
      };
      this.runHistory.set(scriptId, result);
      this.logger.log(`Admin ran script ${scriptId}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result = {
        scriptId,
        success: false,
        ranAt: startedAt,
        output: message.slice(0, 20_000),
      };
      this.runHistory.set(scriptId, result);
      throw new BadRequestException(result.output || 'Script failed');
    }
  }

  private async runInternalAction(action: string): Promise<string> {
    switch (action) {
      case 'invalidate-feed-cache':
        await this.feedService.invalidateFeedCache();
        return 'Feed caches invalidated in Redis.';
      case 'cleanup-temp-uploads':
        this.mediaService.runTempCleanupNow();
        return 'Temp upload/processing directories cleaned.';
      case 'start-r2-migration':
        await this.migrationService.startMigration(4);
        return 'Stream → R2 migration started in background.';
      default:
        throw new NotFoundException(`Unknown internal action: ${action}`);
    }
  }
}
