import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { ShopRecommendationsService } from './shop-recommendations.service';
import { GeminiService } from './gemini.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ShopController],
  providers: [ShopService, ShopRecommendationsService, GeminiService],
  exports: [ShopService],
})
export class ShopModule {}

