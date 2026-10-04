import { ConfigService } from '@nestjs/config';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { RecallConfiguration } from './recall.configuration';
import { RecallWebhookVerifier } from './recall-webhook.verifier';

describe('Recall webhook verification', () => {
  const key = Buffer.alloc(32, 7);
  const secret = `whsec_${key.toString('base64')}`;
  const body = Buffer.from('{ "event": "bot.done" }');
  const verifier = new RecallWebhookVerifier(
    new RecallConfiguration(
      new ConfigService({
        RECALL_WORKSPACE_VERIFICATION_SECRET: secret,
        RECALL_SVIX_WEBHOOK_SECRET: secret,
      }),
    ),
  );

  function headers(prefix = 'webhook', age = 0) {
    const timestamp = String(Math.floor(Date.now() / 1000) + age);
    const signature = createHmac('sha256', key)
      .update(`delivery-1.${timestamp}.`)
      .update(body)
      .digest('base64');
    return {
      [`${prefix}-id`]: 'delivery-1',
      [`${prefix}-timestamp`]: timestamp,
      [`${prefix}-signature`]: `v1,${signature}`,
    };
  }

  it.each(['webhook', 'svix'])('accepts signed %s headers', (prefix) => {
    expect(verifier.verify(headers(prefix), body)).toBe('delivery-1');
  });

  it('rejects a body changed after signing, including whitespace changes', () => {
    expect(() =>
      verifier.verify(headers(), Buffer.from('{"event":"bot.done"}')),
    ).toThrow(UnauthorizedException);
  });

  it.each([-301, 301])(
    'rejects timestamps outside the replay window (%s seconds)',
    (age) => {
      expect(() => verifier.verify(headers('webhook', age), body)).toThrow(
        UnauthorizedException,
      );
    },
  );

  it('accepts a matching signature during secret rotation', () => {
    const signed = headers();
    signed['webhook-signature'] = `v1,invalid ${signed['webhook-signature']}`;
    expect(verifier.verify(signed, body)).toBe('delivery-1');
  });

  it('rejects unsigned requests and unsupported signature versions', () => {
    expect(() => verifier.verify({}, body)).toThrow(UnauthorizedException);
    const signed = headers();
    signed['webhook-signature'] = signed['webhook-signature'].replace(
      'v1,',
      'v2,',
    );
    expect(() => verifier.verify(signed, body)).toThrow(UnauthorizedException);
  });

  it('fails closed when the verification secret is missing', () => {
    const unconfigured = new RecallWebhookVerifier(
      new RecallConfiguration(new ConfigService()),
    );
    expect(() => unconfigured.verify(headers(), body)).toThrow(
      ServiceUnavailableException,
    );
  });
});
