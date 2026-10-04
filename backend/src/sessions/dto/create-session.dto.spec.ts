import { ValidationPipe } from '@nestjs/common';
import { CreateSessionDto } from './create-session.dto';

describe('Session request validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = { type: 'body' as const, metatype: CreateSessionDto };
  const valid = {
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    mode: 'LEARN',
  };

  it('accepts a Google Meet session', async () => {
    await expect(pipe.transform(valid, metadata)).resolves.toMatchObject(valid);
  });

  it.each([
    {
      meetingUrl: 'https://meet.google.com.evil.test/abc-defg-hij',
      mode: 'LEARN',
    },
    { meetingUrl: 'http://meet.google.com/abc-defg-hij', mode: 'LEARN' },
    { ...valid, mode: 'UNKNOWN' },
    { ...valid, workMapId: 'invalid' },
    { ...valid, recallBotId: 'client-controlled-id' },
  ])('rejects invalid or unexpected fields: %j', async (body) => {
    await expect(pipe.transform(body, metadata)).rejects.toThrow();
  });
});
