import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Headers,
  DefaultValuePipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
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
   * POST /v1/shop/upload-image
   * Product photos and shop logos → R2 (`shop/logos/…`, `shop/products/…`).
   */
  @Post('upload-image')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: '/tmp/whapvibez-uploads',
        filename: (_req, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only image files are allowed'), false);
        }
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { kind?: string; shopId?: string; productId?: string },
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('No image file provided');
    const userId: string = req.user?.sub || req.userId;
    if (!userId) throw new BadRequestException('User not authenticated');

    const url = await this.shopService.uploadImage({
      userId,
      filePath: file.path,
      mimeType: file.mimetype,
      kind: body?.kind,
      shopId: body?.shopId,
      productId: body?.productId,
    });
    return { url };
  }

  /**
   * POST /v1/shop/upload-video
   * Product video → R2 (`shop/videos/…`). Does not create a reel.
   */
  @Post('upload-video')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: '/tmp/whapvibez-uploads',
        filename: (_req, file, cb) => cb(null, `${uuidv4()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 150 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only video files are allowed'), false);
        }
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { shopId?: string; productId?: string },
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('No video file provided');
    const userId: string = req.user?.sub || req.userId;
    if (!userId) throw new BadRequestException('User not authenticated');

    return this.shopService.uploadVideo({
      userId,
      filePath: file.path,
      mimeType: file.mimetype,
      shopId: body?.shopId,
      productId: body?.productId,
    });
  }

  /**
   * GET /v1/shop/shops
   * Get shops with optional filtering (cached with Redis)
   */
  @Get('shops')
  async getShops(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
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
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
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
        behavior: userId
          ? {
              viewed: result.signals.viewed.length,
              cart: result.signals.cart.length,
              purchased: result.signals.purchased.length,
              liked: result.signals.liked.length,
            }
          : null,
      },
    };
  }

  /**
   * POST /v1/shop/products/:id/view
   * Track product view for personalized recommendations.
   */
  @Post('products/:id/view')
  @UseGuards(AuthGuard)
  async recordProductView(
    @Param('id') productId: string,
    @CurrentUser() user: any,
  ) {
    await this.shopRecommendationsService.recordProductView(user.sub, productId);
    return { success: true };
  }

  /**
   * POST /v1/shop/recommendations/invalidate
   * Clear cached recommendations after cart/checkout changes.
   */
  @Post('recommendations/invalidate')
  @UseGuards(AuthGuard)
  async invalidateRecommendations(@CurrentUser() user: any) {
    await this.shopRecommendationsService.invalidateUserRecommendations(user.sub);
    return { success: true };
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
