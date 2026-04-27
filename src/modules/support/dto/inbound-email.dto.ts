import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class InboundEmailDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string;

  @IsEmail()
  @MaxLength(180)
  from!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsString()
  @MaxLength(255)
  subject!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  messageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  inReplyTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  to?: string;
}
