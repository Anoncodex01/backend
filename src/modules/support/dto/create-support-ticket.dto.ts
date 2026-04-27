import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  requesterName!: string;

  @IsEmail()
  @MaxLength(180)
  requesterEmail!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(180)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(6000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  categorySlug?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional()
  @IsIn(['web', 'app', 'email', 'admin'])
  source?: 'web' | 'app' | 'email' | 'admin';
}
