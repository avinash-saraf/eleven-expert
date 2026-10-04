#!/usr/bin/env node
// Creates the two ElevenAgents (interviewer and tutor) and prints the env lines to add.
// The real prompts are sent per session by the backend (src/learn/agent-prompts.ts),
// so only voice, turn-taking, tools and override permissions are configured here.
//   ELEVENLABS_API_KEY=... npm run agents:create
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is required');

const client = (
  name,
  description,
  properties = {},
  required = [],
  expectsResponse = true,
) => ({
  type: 'client',
  name,
  description,
  expects_response: expectsResponse,
  parameters: { type: 'object', properties, required },
});
const skipTurn = {
  type: 'system',
  name: 'skip_turn',
  description:
    'Stay silent and let them keep going. Use it whenever they are typing, reading, mid-thought, or have not finished a step.',
};

const common = {
  tts: {
    // eleven_v4_turbo is Expressive Mode. English agents reject eleven_v3_conversational.
    model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_v4_turbo',
    voice_id: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    stability: 0.5,
    expressive_mode: true,
    agent_output_audio_format: 'pcm_24000',
  },
  asr: { provider: 'scribe_realtime', user_input_audio_format: 'pcm_16000' },
  turn: { turn_eagerness: 'normal', turn_timeout: 10 },
};

const agents = {
  ELEVENLABS_LEARN_AGENT_ID: {
    name: 'Ari (Learn)',
    tools: [
      skipTurn,
      client(
        'begin_debrief',
        'Call when the expert agrees to wrap up. Returns follow-up questions and a draft teach-back.',
      ),
      client(
        'confirm_teachback',
        'Call after you taught the process back and the expert confirmed it, or declined.',
        {
          confirmed: {
            type: 'boolean',
            description:
              'True only if the expert said the teach-back is right.',
          },
          corrections: {
            type: 'string',
            description:
              "The expert's corrections in their own words, or empty.",
          },
        },
        ['confirmed'],
      ),
      client(
        'go_off_record',
        'Call the moment the expert asks to take something off the record.',
      ),
      client(
        'back_on_record',
        'Call when the expert says recording may resume.',
      ),
    ],
  },
  ELEVENLABS_TEACH_AGENT_ID: {
    name: 'Ari (Teach)',
    tools: [
      skipTurn,
      client(
        'replay_expert_moment',
        "Show the expert's saved screen moment for a rule on the learner's panel.",
        {
          knowledge_id: {
            type: 'string',
            description:
              'The id of a Work Map knowledge item that has a moment.',
          },
        },
        ['knowledge_id'],
      ),
      client(
        'step_update',
        "Silently record the new hire's progress on a step of the process outline. Never mention it.",
        {
          node_id: {
            type: 'string',
            description: 'A step id from the process outline.',
          },
          status: {
            type: 'string',
            description: 'One of: started, correct, needed_help, mistake.',
          },
          note: {
            type: 'string',
            description: 'A few words on what happened.',
          },
        },
        ['node_id', 'status'],
        false,
      ),
      client(
        'finish_lesson',
        'Call when the case is finished, with what the new hire mastered and what to practice next.',
        {
          mastered: {
            type: 'array',
            description: 'Skills or rules they handled correctly.',
            items: {
              type: 'string',
              description: 'One mastered skill or rule.',
            },
          },
          practice: {
            type: 'array',
            description: 'What they should practice next.',
            items: { type: 'string', description: 'One thing to practice.' },
          },
        },
        ['mastered', 'practice'],
      ),
    ],
  },
};

for (const [envName, { name, tools }] of Object.entries(agents)) {
  // Re-running updates the tools of an existing agent instead of creating a duplicate.
  const existing = process.env[envName];
  if (existing && !existing.startsWith('replace_with')) {
    const update = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${existing}`,
      {
        method: 'PATCH',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_config: { agent: { prompt: { tools } } },
        }),
      },
    );
    if (!update.ok) {
      console.error(
        `${name}: HTTP ${update.status}`,
        JSON.stringify(await update.json().catch(() => ({}))),
      );
      process.exitCode = 1;
    } else console.log(`${envName}=${existing} (tools updated)`);
    continue;
  }
  const response = await fetch(
    'https://api.elevenlabs.io/v1/convai/agents/create',
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        conversation_config: {
          ...common,
          agent: {
            language: 'en',
            first_message: 'Hi!',
            prompt: {
              prompt: 'Replaced per session by the backend.',
              llm: process.env.ELEVENLABS_AGENT_LLM || 'claude-sonnet-4-5',
              tools,
            },
          },
        },
        platform_settings: {
          overrides: {
            conversation_config_override: {
              agent: {
                first_message: true,
                language: true,
                prompt: { prompt: true, llm: true },
              },
              tts: { voice_id: true },
            },
          },
        },
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`${name}: HTTP ${response.status}`, JSON.stringify(body));
    process.exitCode = 1;
    continue;
  }
  console.log(`${envName}=${body.agent_id}`);
}
