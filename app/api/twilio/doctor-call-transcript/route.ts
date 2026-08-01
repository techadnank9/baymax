import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';
import type { Communication } from '@medplum/fhirtypes';

const log = createLogger('api/twilio/doctor-call-transcript');

// phone-bridge POSTs here when a doctor-briefing call ends, with the full turn-by-turn transcript.
export async function POST(req: Request): Promise<NextResponse> {
  const { communicationId, transcript } = (await req.json()) as {
    communicationId: string;
    transcript: { role: string; content: string }[];
  };
  log.info('transcript received', { communicationId, turns: transcript?.length });

  if (!communicationId) {
    return NextResponse.json({ error: 'communicationId is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const communication = await medplum.readResource('Communication', communicationId);

    const transcriptText = (transcript ?? [])
      .map((t) => `${t.role === 'assistant' ? 'Clinic' : 'Doctor'}: ${t.content}`)
      .join('\n');
    const doctorLines = (transcript ?? []).filter((t) => t.role === 'user').map((t) => t.content);

    await medplum.updateResource<Communication>({
      ...communication,
      status: 'completed',
      note: [{ text: doctorLines.length ? doctorLines.join(' ') : '[doctor did not speak during the call]' }],
      payload: [
        ...(communication.payload ?? []),
        { contentString: `Full transcript:\n${transcriptText || '[no transcript captured]'}` },
      ],
    });
    log.info('stored transcript', { communicationId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('failed to store transcript', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
