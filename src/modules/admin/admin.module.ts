import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../core/supabase/supabase.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [SupabaseModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
