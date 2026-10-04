import { IsOptional, IsUUID } from 'class-validator';

export class SessionEventsQueryDto {
  @IsOptional()
  @IsUUID()
  before?: string;
}
