import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { SessionMode } from '../../generated/prisma/enums';

export class CreateSessionDto {
  @Matches(
    /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s#]*)?$/i,
    {
      message: 'meetingUrl must be a Google Meet meeting URL',
    },
  )
  meetingUrl: string;

  @IsEnum(SessionMode)
  mode: SessionMode;

  @IsOptional()
  @IsUUID()
  workMapId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;
}
