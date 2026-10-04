export const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yP6sAAAAASUVORK5CYII=',
  'base64',
);

export function mediaFixture(kind: 'audio' | 'video', botId = 'bot-1') {
  return {
    event:
      kind === 'audio' ? 'audio_separate_raw.data' : 'video_separate_png.data',
    data: {
      bot: { id: botId },
      data: {
        buffer: (kind === 'audio'
          ? Buffer.from([1, 0, 255, 127])
          : TEST_PNG
        ).toString('base64'),
        timestamp: { absolute: '2026-10-03T20:00:00Z', relative: 1.5 },
        participant: { id: 7, name: 'Expert' },
        ...(kind === 'video' ? { type: 'screenshare' } : {}),
      },
    },
  };
}
