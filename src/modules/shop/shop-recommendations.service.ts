import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { GeminiService } from '../../core/gemini/gemini.service';
import { UserShopSignals } from './shop-signals.types';

@Injectable()
export class ShopRecommendationsService {
  private readonly logger = new Logger(ShopRecommendationsService.name);
  private readonly poolSize = 60;
  private readonly embedCacheTtl = 60 * 60 * 24 * 7;

  constructor(
    private supabaseService: SupabaseService,
    private redisService: RedisService,
    private geminiService: GeminiService,
  ) {}

  async getRecommendedProducts(options: {
    userId?: string;
    limit?: number;
    offset?: number;
    category?: string;
  }) {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);
    const cacheKey = `shop:rec:v2:${options.userId || 'guest'}:${options.category || 'all'}:${limit}:${offset}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const interests = options.userId
          ? await this.supabaseService.getUserInterestIds(options.userId)
          : [];

        const signals = options.userId
          ? await this.supabaseService.getUserShopSignals(options.userId)
          : this.emptySignals();

        const pool = await this.supabaseService.getProductRecommendationPool({
          limit: this.poolSize,
          category: options.category,
        });

        if (pool.length === 0) {
          return {
            products: [] as Record<string, any>[],
            source: 'empty' as const,
            interests,
            signals,
          };
        }

        const ranked = await this.rankProducts(pool, interests, signals);
        const page = ranked.products.slice(offset, offset + limit);

        return {
          products: page,
          source: ranked.source,
          interests,
          signals,
        };
      },
      120,
    );
  }

  async recordProductView(userId: string, productId: string): Promise<void> {
    await this.supabaseService.recordUserProductView(userId, productId);
    await this.invalidateUserRecommendations(userId);
  }

  async invalidateUserRecommendations(userId: string): Promise<void> {
    await this.redisService.deletePattern(`shop:rec:v2:${userId}:*`);
  }

  private emptySignals(): UserShopSignals {
    return { viewed: [], cart: [], purchased: [], liked: [] };
  }

  private async rankProducts(
    products: Record<string, any>[],
    interests: string[],
    signals: UserShopSignals,
  ): Promise<{ products: Record<string, any>[]; source: 'gemini' | 'rules' }> {
    const withRules = products
      .map((product) => ({
        product,
        score: this.ruleScore(product, interests, signals),
      }))
      .sort((a, b) => b.score - a.score);

    if (!this.geminiService.isConfigured) {
      return {
        products: withRules.map((entry) => entry.product),
        source: 'rules',
      };
    }

    try {
      const profileText = this.buildProfileText(interests, signals);
      const profileEmbedding = await this.geminiService.embedText(profileText);

      if (!profileEmbedding) {
        return {
          products: withRules.map((entry) => entry.product),
          source: 'rules',
        };
      }

      const productTexts = products.map((product) =>
        this.productText(product),
      );
      const embeddings = await Promise.all(
        products.map((product, index) =>
          this.getProductEmbedding(product.id, productTexts[index]),
        ),
      );

      let usedGemini = false;
      const geminiRanked = products
        .map((product, index) => {
          const embedding = embeddings[index];
          if (embedding) usedGemini = true;
          const semantic = embedding
            ? GeminiService.cosineSimilarity(profileEmbedding, embedding)
            : 0;
          const rules = this.ruleScore(product, interests, signals);
          const score = semantic * 0.6 + rules * 0.4;
          return { product, score };
        })
        .sort((a, b) => b.score - a.score);

      return {
        products: geminiRanked.map((entry) => entry.product),
        source: usedGemini ? 'gemini' : 'rules',
      };
    } catch (error) {
      this.logger.warn(`Gemini ranking fallback to rules: ${error}`);
      return {
        products: withRules.map((entry) => entry.product),
        source: 'rules',
      };
    }
  }

  private async getProductEmbedding(
    productId: string,
    text: string,
  ): Promise<number[] | null> {
    const cacheKey = `shop:embed:product:${productId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as number[];
      } catch {
        // ignore bad cache
      }
    }

    const embedding = await this.geminiService.embedText(text);
    if (embedding) {
      await this.redisService.set(
        cacheKey,
        JSON.stringify(embedding),
        this.embedCacheTtl,
      );
    }
    return embedding;
  }

  private buildProfileText(
    interests: string[],
    signals: UserShopSignals,
  ): string {
    const parts = ['Shopper in Tanzania.'];

    if (interests.length > 0) {
      parts.push(`Interests: ${interests.join(', ')}.`);
    }

    if (signals.purchased.length > 0) {
      parts.push(
        `Previously purchased: ${this.formatSignals(signals.purchased)}.`,
      );
    }

    if (signals.cart.length > 0) {
      parts.push(`Currently in cart: ${this.formatSignals(signals.cart)}.`);
    }

    if (signals.liked.length > 0) {
      parts.push(`Liked products: ${this.formatSignals(signals.liked)}.`);
    }

    if (signals.viewed.length > 0) {
      parts.push(`Recently viewed: ${this.formatSignals(signals.viewed)}.`);
    }

    if (parts.length === 1) {
      parts.push('Looking for trending products, deals, and popular items.');
    }

    return parts.join(' ');
  }

  private formatSignals(
    signals: UserShopSignals['viewed'],
  ): string {
    return signals
      .slice(0, 8)
      .map((item) => {
        const category = item.category ? ` (${item.category})` : '';
        return `${item.name}${category}`;
      })
      .join(', ');
  }

  private productText(product: Record<string, any>): string {
    const name = product.name?.toString() ?? '';
    const description = product.description?.toString() ?? '';
    const category = product.category?.toString() ?? '';
    const price = product.price?.toString() ?? '';
    return `${name}. ${description}. Category: ${category}. Price: ${price} TZS.`;
  }

  private ruleScore(
    product: Record<string, any>,
    interests: string[],
    signals: UserShopSignals,
  ): number {
    const productId = product.id?.toString() ?? '';
    const category = (product.category?.toString() ?? '').toLowerCase();
    const name = (product.name?.toString() ?? '').toLowerCase();
    const description = (product.description?.toString() ?? '').toLowerCase();

    let interestBoost = 0;
    for (const interest of interests) {
      const token = interest.toLowerCase().replace(/[_-]/g, ' ');
      if (
        category.includes(token) ||
        name.includes(token) ||
        description.includes(token)
      ) {
        interestBoost += 0.2;
      }
    }

    let behaviorBoost = 0;
    const purchasedIds = new Set(signals.purchased.map((s) => s.id));
    const cartIds = new Set(signals.cart.map((s) => s.id));
    const likedIds = new Set(signals.liked.map((s) => s.id));
    const viewedIds = new Set(signals.viewed.map((s) => s.id));

    if (purchasedIds.has(productId)) {
      behaviorBoost -= 0.35;
    } else if (cartIds.has(productId)) {
      behaviorBoost += 0.45;
    } else if (likedIds.has(productId)) {
      behaviorBoost += 0.35;
    } else if (viewedIds.has(productId)) {
      behaviorBoost += 0.2;
    }

    const signalCategories = [
      ...signals.purchased,
      ...signals.cart,
      ...signals.liked,
      ...signals.viewed,
    ]
      .map((s) => (s.category ?? '').toLowerCase())
      .filter(Boolean);

    for (const signalCategory of signalCategories) {
      if (category && category.includes(signalCategory)) {
        behaviorBoost += 0.12;
      }
    }

    const sold = Number(product.sold_count ?? 0);
    const views = Number(product.views_count ?? 0);
    const popularity = Math.min(1, (sold * 2 + views * 0.05) / 100);

    const createdAt = product.created_at
      ? new Date(product.created_at).getTime()
      : 0;
    const ageDays = createdAt
      ? (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
      : 365;
    const recency = Math.max(0, 1 - ageDays / 60);

    const quantity = Number(product.quantity ?? 0);
    const inStockBoost = quantity > 0 ? 0.1 : -1;

    return (
      interestBoost +
      behaviorBoost +
      popularity * 0.25 +
      recency * 0.1 +
      inStockBoost
    );
  }
}
