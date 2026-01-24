import { IsInt, IsOptional, IsString, Min, IsIn, IsEmail } from 'class-validator';

export class CreateCardPaymentDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsIn(['TZS', 'KES', 'UGX'])
  currency: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  customerFirstName: string;

  @IsString()
  customerLastName: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsString()
  customerAddress: string;

  @IsString()
  customerCity: string;

  @IsString()
  customerState: string;

  @IsString()
  customerPostcode: string;

  @IsString()
  customerCountry: string;

  @IsString()
  redirectUrl: string;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  kind?: 'coin_topup' | 'shop_order';

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  product?: string;
}
