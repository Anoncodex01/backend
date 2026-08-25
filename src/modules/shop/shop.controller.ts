import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Headers,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopRecommendationsService } from './shop-recommendations.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

@Controller('shop')
export class ShopController {
  constructor(
    private shopService: ShopService,
    private shopRecommendationsService: ShopRecommendationsService,
    private authService: AuthService,
  ) {}

  /**
   * GET /v1/shop/shops
   * Get shops with optional filtering (cached with Redis)
   */
  @Get('shops')
  async getShops(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Query('category') category?: string,
  ) {
    const shops = await this.shopService.getShops({
      limit,
      offset,
      category,
    });

    return {
      success: true,
      data: shops,
      meta: {
        limit,
        offset,
        count: shops.length,
      },
    };
  }

  /**
   * GET /v1/shop/products
   * Get products with optional filtering
   */
  @Get('products')
  async getProducts(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Query('category') category?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    const products = await this.shopService.getProducts({
      limit,
      offset,
      category,
      sellerId,
    });

    return {
      success: true,
      data: products,
      meta: {
        limit,
        offset,
        count: products.length,
      },
    };
  }

  /**
   * GET /v1/shop/products/recommended
   * Gemini-powered product recommendations (personalized when logged in).
   */
  @Get('products/recommended')
  async getRecommendedProducts(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('category') category?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        userId = payload.sub;
      } catch {
        // Continue as guest
      }
    }

    const result = await this.shopRecommendationsService.getRecommendedProducts({
      userId,
      limit,
      offset,
      category,
    });

    return {
      success: true,
      data: result.products,
      meta: {
        limit,
        offset,
        count: result.products.length,
        source: result.source,
        personalized: !!userId,
        interests: result.interests,
      },
    };
  }

  /**
   * GET /v1/shop/products/:id
   * Get single product
   */
  @Get('products/:id')
  async getProduct(@Param('id') productId: string) {
    const product = await this.shopService.getProduct(productId);

    return {
      success: true,
      data: product,
    };
  }

  /**
   * GET /v1/shop/cart/count
   * Total cart quantity for the authenticated user (Redis cached).
   */
  @Get('cart/count')
  @UseGuards(AuthGuard)
  async getCartCount(@CurrentUser() user: any) {
    const count = await this.shopService.getCartCount(user.sub);
    return {
      success: true,
      data: { count },
    };
  }

  /**
   * GET /v1/shop/categories
   * Get all categories
   */
  @Get('categories')
  async getCategories() {
    const categories = await this.shopService.getCategories();

    return {
      success: true,
      data: categories,
    };
  }
}

