import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

@Injectable()
export class SessionApiGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const key = this.config.get<string>('SESSION_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'SESSION_API_KEY is not configured',
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const expected = Buffer.from(`Bearer ${key}`);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new UnauthorizedException('Invalid session API credentials');
    }
    return true;
  }
}
