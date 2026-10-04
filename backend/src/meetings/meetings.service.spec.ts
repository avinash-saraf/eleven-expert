import {
  BadGatewayException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecallConfiguration } from '../recall/recall.configuration';
import { RecallService } from '../recall/recall.service';
import { RecallMediaService } from '../recall/media/recall-media.service';
import { MeetingsService } from './meetings.service';
import { JoinMeetingDto } from './dto/join-meeting.dto';

describe('Meeting join flow', () => {
  let media: RecallMediaService;
  let recall: any;
  let service: MeetingsService;
  let configuration: RecallConfiguration;

  beforeEach(() => {
    media = new RecallMediaService();
    recall = {
      createMediaBot: jest.fn().mockResolvedValue({ id: 'bot-1' }),
      leaveCall: jest.fn().mockResolvedValue(undefined),
    };
    configuration = new RecallConfiguration(
      new ConfigService({
        RECALL_API_KEY: 'test-key',
        RECALL_REGION: 'us-west-2',
        GOOGLE_LOGIN_GROUP_ID: 'group-1',
        RECALL_PUBLIC_WEBSOCKET_URL: 'wss://backend.example.com/recall/media/',
      }),
    );
    service = new MeetingsService(
      recall as RecallService,
      configuration,
      media,
    );
  });

  afterEach(() => media.onModuleDestroy());

  it('creates a media bot using GOOGLE_LOGIN_GROUP_ID and a stream-specific authenticated URL', async () => {
    const result = await service.join('https://meet.google.com/abc-defg-hij');
    expect(result.botId).toBe('bot-1');
    expect(result).not.toHaveProperty('token');
    const [meetingUrl, streamId, callback] =
      recall.createMediaBot.mock.calls[0];
    expect(meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    const url = new URL(callback);
    expect(url.pathname).toBe('/recall/media/');
    expect(url.searchParams.get('streamId')).toBe(streamId);
    expect(media.authenticate(streamId, url.searchParams.get('token'))).toBe(
      streamId,
    );
    expect(media.status(streamId).botId).toBe('bot-1');
  });

  it('retains an inspectable stream when the create request fails, without retrying', async () => {
    recall.createMediaBot.mockRejectedValue(new BadGatewayException());
    try {
      await service.join('https://meet.google.com/abc-defg-hij');
      throw new Error('Expected creation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException);
      const response = error.getResponse();
      expect(media.status(response.streamId).creationFailed).toBe(true);
    }
    expect(recall.createMediaBot).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://backend.example.com/recall/media/',
    'wss://localhost/recall/media/',
    'wss://backend.example.com/wrong-path',
    'wss://backend.example.com/recall/media',
    'wss://backend.example.com/recall/media/?token=static-secret',
  ])('rejects invalid public callback configuration: %s', async (url) => {
    configuration = new RecallConfiguration(
      new ConfigService({
        RECALL_API_KEY: 'key',
        RECALL_REGION: 'us-west-2',
        GOOGLE_LOGIN_GROUP_ID: 'group',
        RECALL_PUBLIC_WEBSOCKET_URL: url,
      }),
    );
    service = new MeetingsService(recall, configuration, media);
    await expect(
      service.join('https://meet.google.com/abc-defg-hij'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(recall.createMediaBot).not.toHaveBeenCalled();
  });

  it('accepts only the requested Google Meet URL field', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const meta = { type: 'body' as const, metatype: JoinMeetingDto };
    await expect(
      pipe.transform(
        { meetingUrl: 'https://meet.google.com/abc-defg-hij' },
        meta,
      ),
    ).resolves.toBeInstanceOf(JoinMeetingDto);
    await expect(
      pipe.transform({ meetingUrl: 'https://example.com' }, meta),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { meetingUrl: 'https://meet.google.com/abc-defg-hij', mode: 'LEARN' },
        meta,
      ),
    ).rejects.toThrow();
  });
});
