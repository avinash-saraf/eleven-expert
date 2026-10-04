// Mock ingestion pipeline. Progress is derived from a stored start time, so it survives navigation.
// Backend: replace with real job status (poll or push) and keep the status values: processing -> mapped.
export const PROCESS_STEPS = ['Transcribing the session', 'Extracting decisions and steps', 'Finding exceptions and guardrails', 'Flagging gaps for your debrief', 'Building your Work Map']
export const STEP_MS = 900
export const PROCESS_MS = PROCESS_STEPS.length * STEP_MS + 600
