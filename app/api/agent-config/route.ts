import { NextResponse } from 'next/server';
import { buildAgentSettings, buildDoctorBriefingPrompt, ALL_TOOL_FUNCTIONS } from '@/lib/deepgram';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { gatherChartContext, chartContextToText } from '@/lib/chart-context';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/agent-config');

// NOTE: for a hackathon/dev build we return the raw Deepgram key to the browser so it can
// authenticate the WebSocket directly (Sec-WebSocket-Protocol: ["token", key]). Swap for a
// scoped/short-lived key before any real deployment.
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const encoding = url.searchParams.get('encoding') === 'mulaw' ? 'mulaw' : 'linear16';
  const mode = url.searchParams.get('mode');
  const patientId = url.searchParams.get('patientId');

  if (mode === 'doctor' && patientId) {
    const medplum = await getAuthenticatedMedplumClient();
    const ctx = await gatherChartContext(medplum, patientId);
    const prompt = buildDoctorBriefingPrompt(ctx.patientName, chartContextToText(ctx));
    const opener = ctx.redFlags.length
      ? `Hi Doctor, calling with an urgent update on ${ctx.patientName}.`
      : `Hi Doctor, calling with an update on ${ctx.patientName}.`;

    const settings = buildAgentSettings({
      greeting: opener,
      prompt,
      // No client-side tools -- this is a read-only conversation grounded in the chart text
      // already embedded in the prompt above.
      functions: [],
      encoding,
    });
    log.info('serving doctor-mode settings', { patientId, redFlags: ctx.redFlags.length });
    return NextResponse.json({
      wsUrl: 'wss://agent.deepgram.com/v1/agent/converse',
      apiKey: process.env.DEEPGRAM_API_KEY,
      settings,
    });
  }

  // Identity is voice-driven for patient intake (identifyPatient tool, called by the agent once
  // it hears the patient's name) -- no patientId needed ahead of time here.
  const settings = buildAgentSettings({
    greeting: "Hi, welcome in! Could I get your full name to pull up your record?",
    functions: ALL_TOOL_FUNCTIONS,
    encoding,
  });
  log.info('serving patient-intake settings', { functionNames: ALL_TOOL_FUNCTIONS.map((f) => f.name) });
  return NextResponse.json({
    wsUrl: 'wss://agent.deepgram.com/v1/agent/converse',
    apiKey: process.env.DEEPGRAM_API_KEY,
    settings,
  });
}
