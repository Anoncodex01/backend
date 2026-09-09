import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { FfmpegService } from '../media/ffmpeg.service';
import { R2Service } from '../media/r2.service';

export interface ShopUploadResult {
  url: string;
  thumbnailUrl?: string;
}

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private r2Service: R2Service,
    private ffmpegService: FfmpegService,
  ) {}

  private safeSegment(value: string | undefined, fallback: string): string {
    const cleaned = (value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    return cleaned || fallback;
  }

  private imageExt(mimeType: string): string {
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/gif') return 'gif';
    return 'jpg';
  }

  private videoExt(mimeType: string): string {
    if (mimeType === 'video/quicktime') return 'mov';
    if (mimeType === 'video/webm') return 'webm';
    return 'mp4';
  }

  /**
   * Public shop image → R2.
   * kind=logo → shop/logos/{shopId}/…
   * kind=product → shop/products/{shopId}/{productId}/…
   */
  async uploadImage(options: {
    userId: string;
    filePath: string;
    mimeType: string;
    kind?: string;
    shopId?: string;
    productId?: string;
  }): Promise<string> {
    const ownerId = this.safeSegment(options.shopId, options.userId);
    const stamp = Date.now();
    const ext = this.imageExt(options.mimeType);
    const isLogo = (options.kind || '').toLowerCase() === 'logo';
    const key = isLogo
      ? `shop/logos/${ownerId}/${stamp}.${ext}`
      : `shop/products/${ownerId}/${this.safeSegment(options.productId, 'new')}/${stamp}.${ext}`;

    try {
      return await this.r2Service.uploadFile(key, options.filePath, options.mimeType);
    } finally {
      fs.unlink(options.filePath, () => {});
    }
  }

  /**
   * Product video → R2 (does not create a reel).
   * shop/videos/{shopId}/{productId}/…
   */
  async uploadVideo(options: {
    userId: string;
    filePath: string;
    mimeType: string;
    shopId?: string;
    productId?: string;
  }): Promise<ShopUploadResult> {
    const ownerId = this.safeSegment(options.shopId, options.userId);
    const productId = this.safeSegment(options.productId, 'new');
    const stamp = Date.now();
    const ext = this.videoExt(options.mimeType);
    const key = `shop/videos/${ownerId}/${productId}/${stamp}.${ext}`;
    const thumbKey = `shop/videos/${ownerId}/${productId}/${stamp}_thumb.jpg`;
    const thumbPath = path.join('/tmp/whapvibez-uploads', `${stamp}_shop_thumb.jpg`);

    let thumbnailUrl: string | undefined;
    try {
      try {
        await this.ffmpegService.extractThumbnail(options.filePath, thumbPath);
        thumbnailUrl = await this.r2Service.uploadFile(thumbKey, thumbPath, 'image/jpeg');
      } catch (error) {
        this.logger.warn(`Shop video thumbnail failed: ${(error as Error).message}`);
      }

      const url = await this.r2Service.uploadFile(key, options.filePath, options.mimeType);
      return { url, thumbnailUrl };
    } finally {
      fs.unlink(options.filePath, () => {});
      fs.unlink(thumbPath, () => {});
    }
  }

  /**
   * Get shops with caching (includes product counts)
   */
  async getShops(options: {
    limit?: number;
    offset?: number;
    category?: string;
  } = {}) {
    const cacheKey = `shops:${options.category || 'all'}:${options.offset || 0}:${options.limit || 20}`;

    return this.redisService.getOrSet(
      cacheKey,
      () => this.supabaseService.getShops(options),
      120, // Cache for 2 minutes (shops don't change as frequently)
    );
  }

  /**
   * Get products with caching
   */
  async getProducts(options: {
    limit?: number;
    offset?: number;
    category?: string;
    sellerId?: string;
  }) {
    const cacheKey = `products:${options.category || 'all'}:${options.sellerId || 'all'}:${options.offset || 0}:${options.limit || 20}`;

    return this.redisService.getOrSet(
      cacheKey,
      () => this.supabaseService.getProducts(options),
      60, // Cache for 60 seconds
    );
  }

  /**
   * Get product by ID
   */
  async getProduct(productId: string) {
    const cacheKey = `product:${productId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const client = this.supabaseService.getClient();
        const { data, error } = await client
          .from('products')
          .select(`
            *,
            shops(*),
            users:user_id (
              id,
              username,
              full_name,
              profile_image_url,
              is_verified,
              followers_count
            )
          `)
          .eq('id', productId)
          .eq('is_active', true)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      120, // Cache for 2 minutes
    );
  }

  /**
   * Get categories
   */
  async getCategories() {
    return this.redisService.getOrSet(
      'product_categories',
      async () => {
        const client = this.supabaseService.getClient();
        const { data, error } = await client
          .from('products')
          .select('category')
          .eq('is_active', true);

        if (error) throw error;

        // Get unique categories
        const categories = [...new Set(data.map((p) => p.category))];
        return categories.filter(Boolean);
      },
      300, // Cache for 5 minutes
    );
  }

  /**
   * Get cart item count for authenticated user (Redis cached).
   */
  async getCartCount(userId: string): Promise<number> {
    const cacheKey = `shop:cart-count:${userId}`;
    return this.redisService.getOrSet(
      cacheKey,
      () => this.supabaseService.getCartItemCount(userId),
      30,
    );
  }

  async invalidateCartCount(userId: string): Promise<void> {
    await this.redisService.del(`shop:cart-count:${userId}`);
  }

  /**
   * Invalidate product cache
   */
  async invalidateProductCache(productId?: string) {
    if (productId) {
      await this.redisService.del(`product:${productId}`);
    }
    await this.redisService.deletePattern('products:*');
    await this.redisService.del('product_categories');
  }
}
