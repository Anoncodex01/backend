import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminReplyTicketDto {
  @IsString()
  @MinLength(2)
  @MaxLength(12000)
  bodyText!: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  adminName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  adminEmail?: string;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
