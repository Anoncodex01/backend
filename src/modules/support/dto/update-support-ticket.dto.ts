import { IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSupportTicketDto {
  @IsOptional()
  @IsIn(['open', 'pending_customer', 'pending_support', 'resolved', 'closed'])
  status?: 'open' | 'pending_customer' | 'pending_support' | 'resolved' | 'closed';

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedTo?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  assignedEmail?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];
}
