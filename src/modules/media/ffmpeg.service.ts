import { Injectable, Logger } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export interface EncodingResult {
  hlsDir: string;
  playlistPath: string;
  thumbnailPath: string;
  segmentPaths: string[];
}

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly tempDir = '/tmp/whapvibez-processing';

  async encodeVideo(inputPath: string, jobId: string): Promise<EncodingResult> {
    const outputDir = path.join(this.tempDir, jobId);
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');

    await this.generateThumbnail(inputPath, outputDir);
    this.logger.log(`[${jobId}] Thumbnail generated`);

    await this.encodeToHls(inputPath, playlistPath, outputDir);
    this.logger.log(`[${jobId}] HLS encoding complete`);

    const segmentPaths = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(outputDir, f));

    return { hlsDir: outputDir, playlistPath, thumbnailPath, segmentPaths };
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
          // Fallback: grab very first frame
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

  private encodeToHls(inputPath: string, playlistPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-crf 23',
          '-preset fast',
          '-profile:v baseline',
          '-level 3.0',
          '-g 48',
          '-keyint_min 48',
          '-sc_threshold 0',
          '-c:a aac',
          '-b:a 128k',
          '-ar 44100',
          '-movflags +faststart',
          '-hls_time 4',
          '-hls_list_size 0',
          '-hls_flags independent_segments',
          `-hls_segment_filename ${path.join(outputDir, 'chunk%03d.ts')}`,
          '-f hls',
        ])
        .output(playlistPath)
        .on('start', (cmd: string) => this.logger.debug(`FFmpeg cmd: ${cmd}`))
        .on('progress', (progress: { percent?: number }) => {
          if (progress.percent) {
            this.logger.debug(`Encoding: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }

  cleanup(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      this.logger.warn(`Cleanup failed for ${dir}: ${e}`);
    }
  }
}
