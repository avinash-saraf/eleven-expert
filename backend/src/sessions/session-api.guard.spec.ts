import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionApiGuard } from './session-api.guard';

describe('Session API authorization', () => {
  function context(authorization?: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    } as unknown as ExecutionContext;
  }

  const guard = new SessionApiGuard(
    new ConfigService({ SESSION_API_KEY: 'test-key' }),
  );

  it('accepts the configured bearer key', () => {
    expect(guard.canActivate(context('Bearer test-key'))).toBe(true);
  });

  it.each([undefined, 'test-key', 'Bearer wrong-key'])(
    'rejects invalid authorization %s',
    (value) => {
      expect(() => guard.canActivate(context(value))).toThrow(
        UnauthorizedException,
      );
    },
  );

  it('fails closed when the session key has not been configured', () => {
    const missing = new SessionApiGuard(new ConfigService());
    expect(() => missing.canActivate(context('Bearer test-key'))).toThrow(
      ServiceUnavailableException,
    );
  });
});
