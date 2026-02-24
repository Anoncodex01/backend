import { IsEnum, IsOptional, IsString } from 'class-validator';

export class SubmitKycDto {
  @IsEnum(['id_card', 'passport', 'driving_licence'])
  idDocumentType: 'id_card' | 'passport' | 'driving_licence';

  @IsString()
  idFrontUrl: string;

  @IsOptional()
  @IsString()
  idBackUrl?: string;

  @IsString()
  selfieUrl: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;
}
