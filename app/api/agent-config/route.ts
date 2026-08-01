import { NextResponse } from 'next/server';
import { buildAgentSettings, ALL_TOOL_FUNCTIONS } from '@/lib/deepgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/agent-config');

// NOTE: for a hackathon/dev build we return the raw Deepgram key to the browser so it can
// authenticate the WebSocket directly (Sec-WebSocket-Protocol: ["token", key]). Swap for a
// scoped/short-lived key before any real deployment.
//
// Identity is voice-driven now (identifyPatient tool, called by the agent once it hears the
// patient's name) -- this route no longer needs a patientId ahead of time, so the greeting is
// always the generic "what's your name" opener. See lib/deepgram.ts SYSTEM_PROMPT.
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const encoding = url.searchParams.get('encoding') === 'mulaw' ? 'mulaw' : 'linear16';

  const settings = buildAgentSettings({
    greeting: "Hi, welcome in! Could I get your full name to pull up your record?",
    functions: ALL_TOOL_FUNCTIONS,
    encoding,
  });
  log.info('serving settings', { functionNames: ALL_TOOL_FUNCTIONS.map((f) => f.name) });
  return NextResponse.json({
    wsUrl: 'wss://agent.deepgram.com/v1/agent/converse',
    apiKey: process.env.DEEPGRAM_API_KEY,
    settings,
  });
}
