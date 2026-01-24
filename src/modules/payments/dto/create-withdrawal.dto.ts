import { IsInt, IsOptional, IsString, Min, IsIn } from 'class-validator';

export class CreateWithdrawalDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsIn(['TZS', 'KES', 'UGX'])
  currency: string;

  @IsString()
  method: string; // e.g. mobile, bank

  @IsString()
  account: string; // phone number or account number

  @IsOptional()
  metadata?: Record<string, any>;
}
