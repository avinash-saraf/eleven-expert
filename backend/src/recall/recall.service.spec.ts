import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecallConfiguration } from './recall.configuration';
import { RecallService } from './recall.service';

describe('Recall API client', () => {
  const service = new RecallService(
    new RecallConfiguration(
      new ConfigService({
        RECALL_REGION: 'us-west-2',
        RECALL_API_KEY: 'test-api-key',
        RECALL_GOOGLE_LOGIN_GROUP_ID: 'test-group',
      }),
    ),
  );
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('creates a bot in the configured region with the signed-in group and session metadata', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'bot-1' }), { status: 201 }),
    );
    await expect(
      service.createBot({
        id: 'session-1',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        mode: 'LEARN',
      }),
    ).resolves.toEqual({ id: 'bot-1' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us-west-2.recall.ai/api/v1/bot/');
    expect(options.headers.Authorization).toBe('Token test-api-key');
    expect(JSON.parse(options.body)).toEqual({
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      google_meet: { google_login_group_id: 'test-group' },
      metadata: { session_id: 'session-1', mode: 'LEARN' },
    });
  });

  it('handles an empty response from leave_call', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    await expect(service.leaveCall('bot-1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://us-west-2.recall.ai/api/v1/bot/bot-1/leave_call/',
    );
  });

  it('creates a signed-in web_4_core bot with separate audio and PNG realtime callbacks', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'bot-1' }), { status: 201 }),
    );
    const callback =
      'wss://backend.example.com/recall/media/?streamId=stream-1&token=test-token';
    await expect(
      service.createMediaBot(
        'https://meet.google.com/abc-defg-hij',
        'stream-1',
        callback,
      ),
    ).resolves.toEqual({ id: 'bot-1' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      google_meet: {
        google_login_group_id: 'test-group',
        login_required: true,
      },
      variant: { google_meet: 'web_4_core' },
      metadata: { media_stream_id: 'stream-1' },
      recording_config: {
        audio_separate_raw: {},
        video_separate_png: {},
        video_mixed_layout: 'gallery_view_v2',
        realtime_endpoints: [
          {
            type: 'websocket',
            url: callback,
            events: ['audio_separate_raw.data', 'video_separate_png.data'],
          },
        ],
      },
    });
  });

  it('retrieves a bot without a create request or request body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'bot-1' })));
    await expect(service.retrieveBot('bot-1')).resolves.toEqual({
      id: 'bot-1',
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      body: undefined,
    });
  });

  it('redacts provider error bodies and does not retry failed creation', async () => {
    fetchMock.mockResolvedValue(
      new Response('sensitive provider details', { status: 401 }),
    );
    await expect(
      service.createBot({ id: 'session-1', meetingUrl: 'url', mode: 'LEARN' }),
    ).rejects.toThrow('Recall request failed (401)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns transport failures and invalid bot responses into gateway errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('test-api-key'));
    await expect(service.leaveCall('bot-1')).rejects.toThrow(
      'Recall request failed or timed out',
    );
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await expect(
      service.createBot({ id: 's', meetingUrl: 'url', mode: 'LEARN' }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('rejects invalid regions before making any external request', async () => {
    const invalid = new RecallService(
      new RecallConfiguration(new ConfigService({ RECALL_REGION: 'invalid' })),
    );
    await expect(invalid.retrieveBot('bot-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
