import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import { Readable } from 'stream';

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  readonly cdnUrl: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>('R2_ENDPOINT');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID', '');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY', '');
    this.bucket = this.configService.get<string>('R2_BUCKET', 'whapvibez-media');
    this.cdnUrl = (this.configService.get<string>('R2_CDN_URL', 'https://cdn.whapvibez.com')).replace(/\/$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async uploadFile(key: string, filePath: string, contentType: string): Promise<string> {
    const fileStream = fs.createReadStream(filePath);
    const stat = fs.statSync(filePath);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
        ContentLength: stat.size,
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });

    await upload.done();
    this.logger.log(`Uploaded to R2: ${key}`);
    return `${this.cdnUrl}/${key}`;
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return `${this.cdnUrl}/${key}`;
  }

  async uploadStream(key: string, stream: Readable, contentType: string): Promise<string> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
      },
    });
    await upload.done();
    return `${this.cdnUrl}/${key}`;
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (e) {
      this.logger.warn(`Failed to delete R2 key ${key}: ${e}`);
    }
  }

  async deleteFolder(prefix: string): Promise<void> {
    try {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const list = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }));
      const objects = (list.Contents || []).map((o) => ({ Key: o.Key! }));
      if (objects.length === 0) return;
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: objects },
      }));
    } catch (e) {
      this.logger.warn(`Failed to delete R2 folder ${prefix}: ${e}`);
    }
  }

  getPublicUrl(key: string): string {
    return `${this.cdnUrl}/${key}`;
  }
}
