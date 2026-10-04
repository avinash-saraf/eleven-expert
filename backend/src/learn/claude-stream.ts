import { providerError } from './apprentice-error';

// Only expose complete root properties: never speak a truncated or escaped JSON string.
function completedFields(text: string): Record<string, unknown> {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let boundary = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(0, i + 1));
    } else if (char === ',' && depth === 1) boundary = i;
  }
  return boundary ? JSON.parse(text.slice(0, boundary) + '}') : {};
}

export async function readClaudeStream(
  response: Response,
  secrets: string[],
  onFields?: (fields: Record<string, unknown>) => void,
): Promise<string> {
  if (!response.body) throw new Error('Invalid Claude response: no stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopped = false;
  let stopReason: string | undefined;
  const consume = async (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    const message = JSON.parse(data);
    if (message.type === 'error') {
      // Reuse the redacted provider error path for failures after HTTP 200.
      throw await providerError(
        'Claude stream',
        new Response(data, {
          status: 502,
          headers: { 'request-id': response.headers.get('request-id') ?? '' },
        }),
        secrets,
      );
    }
    if (
      message.type === 'content_block_start' &&
      message.content_block?.type === 'text'
    )
      text += message.content_block.text ?? '';
    if (
      message.type === 'content_block_delta' &&
      message.delta?.type === 'text_delta'
    ) {
      text += message.delta.text;
      if (text.length > 128 * 1024)
        throw new Error('Invalid Claude response: oversized JSON');
      onFields?.(completedFields(text));
    }
    if (message.type === 'message_delta')
      stopReason = message.delta?.stop_reason ?? stopReason;
    if (message.type === 'message_stop') stopped = true;
  };
  try {
    while (!stopped) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        await consume(event);
      }
      if (done) {
        if (buffer.trim()) await consume(buffer);
        break;
      }
    }
    if (!stopped)
      throw new Error('Invalid Claude response: interrupted stream');
    if (stopReason === 'max_tokens')
      throw new Error(
        'Claude response exceeded max_tokens; shorten the requested output',
      );
    if (stopReason === 'refusal')
      throw new Error('Claude returned a refusal for this observation');
    if (!text) throw new Error('Invalid Claude response: no JSON text');
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
