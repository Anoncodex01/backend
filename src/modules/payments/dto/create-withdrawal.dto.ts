import { IsInt, IsOptional, IsString, Min, IsIn } from 'class-validator';

export class CreateWithdrawalDto {
  @IsInt()
  @Min(1)
  amount: number; // amount in TZS to be paid out

  @IsOptional()
  @IsString()
  @IsIn(['TZS'])
  currency?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
