import { Injectable, Logger } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export interface HlsUploadFile {
  r2Key: string;
  localPath: string;
  contentType: string;
}

export interface EncodingResult {
  hlsDir: string;
  masterPlaylistPath: string;
  thumbnailPath: string;
  faststartPath: string;
  uploadFiles: HlsUploadFile[];
}

interface HlsVariant {
  name: string;
  width: number;
  height: number;
  videoBitrate: string;
  maxrate: string;
  bufsize: string;
  preset: string;
  bandwidth: number;
}

const HLS_VARIANTS: HlsVariant[] = [
  {
    name: '360p',
    width: 360,
    height: 640,
    videoBitrate: '450k',
    maxrate: '500k',
    bufsize: '900k',
    preset: 'veryfast',
    bandwidth: 580_000,
  },
  {
    name: '480p',
    width: 480,
    height: 854,
    videoBitrate: '900k',
    maxrate: '1000k',
    bufsize: '1800k',
    preset: 'veryfast',
    bandwidth: 1_080_000,
  },
  {
    name: '720p',
    width: 720,
    height: 1280,
    videoBitrate: '2000k',
    maxrate: '2200k',
    bufsize: '4000k',
    preset: 'fast',
    bandwidth: 2_280_000,
  },
];

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly tempDir = '/tmp/whapvibez-processing';

  async encodeVideo(inputPath: string, jobId: string, postId: string): Promise<EncodingResult> {
    const outputDir = path.join(this.tempDir, jobId);
    fs.mkdirSync(outputDir, { recursive: true });

    const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
    const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');

    await this.generateThumbnail(inputPath, outputDir);
    this.logger.log(`[${jobId}] Thumbnail generated`);

    for (const variant of HLS_VARIANTS) {
      this.logger.log(`[${jobId}] Encoding ${variant.name} (${variant.width}x${variant.height})`);
      await this.encodeVariant(inputPath, outputDir, variant, jobId);
    }

    this.writeMasterPlaylist(outputDir, masterPlaylistPath);
    this.logger.log(`[${jobId}] ABR HLS encoding complete (3 variants + master)`);

    this.logger.log(`[${jobId}] Encoding 360p faststart MP4`);
    const faststartPath = await this.encodeFaststart(inputPath, outputDir, jobId);
    this.logger.log(`[${jobId}] Faststart MP4 ready`);

    const uploadFiles = this.collectUploadFiles(outputDir, postId);

    return { hlsDir: outputDir, masterPlaylistPath, thumbnailPath, faststartPath, uploadFiles };
  }

  /** Extract a JPEG poster frame for short-form uploads (e.g. stories). */
  async extractThumbnail(inputPath: string, outputPath: string): Promise<void> {
    const outputDir = path.dirname(outputPath);
    const filename = path.basename(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: ['1'],
          filename,
          folder: outputDir,
          size: '720x?',
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          this.logger.warn(`Story thumbnail at 1s failed, trying frame 0: ${err.message}`);
          ffmpeg(inputPath)
            .screenshots({
              timestamps: ['0'],
              filename,
              folder: outputDir,
              size: '720x?',
            })
            .on('end', () => resolve())
            .on('error', (err2: Error) => reject(err2));
        });
    });
  }

  private generateThumbnail(inputPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: ['1'],
          filename: 'thumbnail.jpg',
          folder: outputDir,
          size: '720x?',
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          this.logger.warn(`Thumbnail generation failed, trying frame 0: ${err.message}`);
          ffmpeg(inputPath)
            .screenshots({
              timestamps: ['0'],
              filename: 'thumbnail.jpg',
              folder: outputDir,
              size: '720x?',
            })
            .on('end', () => resolve())
            .on('error', (err2: Error) => reject(err2));
        });
    });
  }

  private encodeVariant(
    inputPath: string,
    outputDir: string,
    variant: HlsVariant,
    jobId: string,
  ): Promise<void> {
    const variantDir = path.join(outputDir, variant.name);
    fs.mkdirSync(variantDir, { recursive: true });

    const playlistPath = path.join(variantDir, 'playlist.m3u8');
    const scaleFilter =
      `scale=${variant.width}:${variant.height}:force_original_aspect_ratio=decrease,` +
      `pad=${variant.width}:${variant.height}:(ow-iw)/2:(oh-ih)/2`;

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-pix_fmt yuv420p',
          `-vf ${scaleFilter}`,
          '-c:v libx264',
          `-b:v ${variant.videoBitrate}`,
          `-maxrate ${variant.maxrate}`,
          `-bufsize ${variant.bufsize}`,
          `-preset ${variant.preset}`,
          '-profile:v high',
          '-level 4.1',
          '-g 48',
          '-keyint_min 48',
          '-sc_threshold 0',
          '-c:a aac',
          '-b:a 128k',
          '-ar 44100',
          '-hls_time 2',
          '-hls_list_size 0',
          '-hls_flags independent_segments',
          `-hls_segment_filename ${path.join(variantDir, 'chunk%03d.ts')}`,
          '-f hls',
        ])
        .output(playlistPath)
        .on('start', (cmd: string) => this.logger.debug(`[${jobId}] ${variant.name} FFmpeg: ${cmd}`))
        .on('progress', (progress: { percent?: number }) => {
          if (progress.percent) {
            this.logger.debug(`[${jobId}] ${variant.name}: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`${variant.name} encode failed: ${err.message}`)))
        .run();
    });
  }

  private writeMasterPlaylist(outputDir: string, masterPath: string): void {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

    for (const variant of HLS_VARIANTS) {
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.width}x${variant.height}`,
        `${variant.name}/playlist.m3u8`,
      );
    }

    fs.writeFileSync(masterPath, `${lines.join('\n')}\n`);
  }

  private encodeFaststart(inputPath: string, outputDir: string, jobId: string): Promise<string> {
    const outputPath = path.join(outputDir, '360p_faststart.mp4');
    const scaleFilter =
      'scale=360:640:force_original_aspect_ratio=decrease,' +
      'pad=360:640:(ow-iw)/2:(oh-ih)/2';

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-pix_fmt yuv420p',
          `-vf ${scaleFilter}`,
          '-c:v libx264',
          '-b:v 500k',
          '-maxrate 600k',
          '-bufsize 1200k',
          '-preset veryfast',
          '-profile:v high',
          '-level 4.1',
          '-c:a aac',
          '-b:a 64k',
          '-ar 44100',
          '-movflags +faststart',
          '-f mp4',
        ])
        .output(outputPath)
        .on('start', (cmd: string) => this.logger.debug(`[${jobId}] faststart FFmpeg: ${cmd}`))
        .on('end', () => resolve(outputPath))
        .on('error', (err: Error) => reject(new Error(`faststart encode failed: ${err.message}`)))
        .run();
    });
  }

  private collectUploadFiles(outputDir: string, postId: string): HlsUploadFile[] {
    const files: HlsUploadFile[] = [];

    const walk = (dir: string, relPrefix: string) => {
      for (const name of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, name);
        const relPath = relPrefix ? `${relPrefix}/${name}` : name;

        if (fs.statSync(fullPath).isDirectory()) {
          walk(fullPath, relPath);
          continue;
        }

        if (name.endsWith('.ts')) {
          files.push({
            r2Key: `videos/${postId}/${relPath}`,
            localPath: fullPath,
            contentType: 'video/MP2T',
          });
        } else if (name.endsWith('.m3u8') && name !== 'master.m3u8') {
          files.push({
            r2Key: `videos/${postId}/${relPath}`,
            localPath: fullPath,
            contentType: 'application/vnd.apple.mpegurl',
          });
        }
      }
    };

    walk(outputDir, '');
    return files;
  }

  cleanup(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      this.logger.warn(`Cleanup failed for ${dir}: ${e}`);
    }
  }
}
