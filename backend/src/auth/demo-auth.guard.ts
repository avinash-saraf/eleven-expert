import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DemoRequest } from './demo-identity';

@Injectable()
export class DemoAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<DemoRequest>();
    request.identity = await this.auth.authenticate(
      request.headers.authorization,
    );
    return true;
  }
}
