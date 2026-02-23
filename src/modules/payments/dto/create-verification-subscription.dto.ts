import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateVerificationSubscriptionDto {
  @IsString()
  @IsIn(['monthly', '6months', 'yearly'])
  planCode: 'monthly' | '6months' | 'yearly';

  @IsString()
  @IsIn(['mobile', 'card'])
  paymentType: 'mobile' | 'card';

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @IsOptional()
  @IsString()
  cancelUrl?: string;

  @IsOptional()
  @IsString()
  customerFirstName?: string;

  @IsOptional()
  @IsString()
  customerLastName?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;
}
