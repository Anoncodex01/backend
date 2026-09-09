import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { ShopRecommendationsService } from './shop-recommendations.service';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ShopController],
  providers: [ShopService, ShopRecommendationsService],
  exports: [ShopService],
})
export class ShopModule {}

