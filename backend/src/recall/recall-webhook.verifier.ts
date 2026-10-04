import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IncomingHttpHeaders } from 'node:http';
import { RecallConfiguration } from './recall.configuration';

@Injectable()
export class RecallWebhookVerifier {
  constructor(private readonly configuration: RecallConfiguration) {}

  verify(headers: IncomingHttpHeaders, rawBody: Buffer) {
    const prefix = headers['webhook-id'] ? 'webhook' : 'svix';
    const id = headers[`${prefix}-id`];
    const timestamp = headers[`${prefix}-timestamp`];
    const signatures = headers[`${prefix}-signature`];
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 256 ||
      typeof timestamp !== 'string' ||
      !/^\d+$/.test(timestamp) ||
      typeof signatures !== 'string' ||
      !Buffer.isBuffer(rawBody)
    ) {
      throw new UnauthorizedException(
        'Missing or invalid Recall verification headers',
      );
    }
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      throw new UnauthorizedException(
        'Recall signature timestamp is outside the allowed window',
      );
    }
    const secret = this.configuration.getWebhookSecret(prefix === 'svix');
    const key = Buffer.from(secret.slice(6), 'base64');
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.`)
      .update(rawBody)
      .digest();
    const valid = signatures.split(' ').some((entry) => {
      const [version, signature] = entry.split(',');
      if (version !== 'v1' || !signature) return false;
      const candidate = Buffer.from(signature, 'base64');
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      );
    });
    if (!valid) throw new UnauthorizedException('Invalid Recall signature');
    return id;
  }
}
