import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ShopService } from './shop.service';

@Controller('shop')
export class ShopController {
  constructor(private shopService: ShopService) {}

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

