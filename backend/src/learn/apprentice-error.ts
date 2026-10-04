export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

// Read only provider error fields, never log a request body, transcript or keys.
export async function providerError(
  provider: string,
  response: Response,
  secrets: string[],
): Promise<ProviderRequestError> {
  const body = await response.json().catch(() => null);
  const detail = body?.error ?? body?.detail;
  const type = detail?.type ?? detail?.status;
  const message = typeof detail === 'string' ? detail : detail?.message;
  const requestId = response.headers.get('request-id') ?? body?.request_id;
  let text = `${provider} HTTP ${response.status}`;
  if (typeof type === 'string') text += ` (${type})`;
  if (typeof message === 'string') text += `: ${message}`;
  if (typeof requestId === 'string') text += ` [request_id=${requestId}]`;
  for (const secret of secrets.filter(Boolean))
    text = text.split(secret).join('[redacted]');
  text = text
    .replace(/(?:sk-|xi-)[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 1200);
  return new ProviderRequestError(text, response.status);
}

export class ApprenticeStageError extends Error {
  constructor(stage: string, error: unknown) {
    super(`${stage}: ${describeError(error)}`);
    this.name = 'ApprenticeStageError';
  }
}

export function describeError(error: unknown): string {
  if (
    error instanceof ProviderRequestError ||
    error instanceof ApprenticeStageError
  )
    return error.message;
  const record = error as {
    name?: string;
    code?: string;
    cause?: { code?: string };
  } | null;
  const code = record?.code ?? record?.cause?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) {
    const hints: Record<string, string> = {
      P2021: 'Database table missing; apply the existing migrations',
      P2022: 'Database column missing; apply the existing migrations',
      P2025: 'Database record not found',
      P2034: 'Concurrent database write could not be retried',
      P1000: 'Database authentication failed',
      P1001: 'Database unavailable',
      ECONNREFUSED: 'Connection refused',
      ENOTFOUND: 'Host lookup failed',
      ETIMEDOUT: 'Connection timed out',
    };
    return `${code}${hints[code] ? `: ${hints[code]}` : ''}`;
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'Request timed out';
    if (
      /^(Invalid Claude|Claude response|Claude returned|Recall output|Recall playback|Incomplete PCM|Speech cancelled)/.test(
        error.message,
      )
    )
      return error.message.slice(0, 300);
    return /^[A-Za-z]{1,60}$/.test(error.name) ? error.name : 'Unknown error';
  }
  return 'Unknown error';
}
