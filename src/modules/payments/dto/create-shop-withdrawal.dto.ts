import { IsInt, IsOptional, IsString, Min, IsIn } from 'class-validator';

export class CreateShopWithdrawalDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsIn(['mobile', 'bank'])
  channel: string;

  @IsString()
  recipientPhone: string;

  @IsString()
  recipientName: string;

  @IsOptional()
  @IsString()
  narration?: string;
}
