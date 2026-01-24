import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateGiftTransferDto {
  @IsString()
  receiverId: string;

  @IsInt()
  @Min(1)
  coinCost: number;

  @IsString()
  giftName: string;

  @IsString()
  giftIcon: string;

  @IsOptional()
  @IsString()
  liveId?: string;
}
