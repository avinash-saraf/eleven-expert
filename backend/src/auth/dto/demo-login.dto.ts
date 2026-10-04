import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';
import { normalizeName } from '../demo-identity';

const cleanName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeName(value) : value;

export class DemoLoginDto {
  @Transform(cleanName)
  @IsString()
  @Length(1, 120)
  organizationName: string;

  @Transform(cleanName)
  @IsString()
  @Length(1, 120)
  name: string;

  @IsIn(['expert', 'employee'])
  role: 'expert' | 'employee';
}
