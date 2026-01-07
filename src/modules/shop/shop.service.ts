import { Injectable } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class ShopService {
  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
  ) {}

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
    const cacheKey = `products:${options.category || 'all'}:${options.offset || 0}:${options.limit || 20}`;

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
            seller:seller_id (
              id,
              username,
              full_name,
              profile_image_url
            )
          `)
          .eq('id', productId)
          .single();

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

