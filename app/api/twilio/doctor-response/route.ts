import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';
import type { Communication } from '@medplum/fhirtypes';

const log = createLogger('api/twilio/doctor-response');

// Twilio POSTs here (form-encoded) once the doctor finishes speaking after the Gather prompt.
// The response body IS TwiML spoken back to the doctor to close out the call.
export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const communicationId = url.searchParams.get('communicationId');
  const form = await req.formData();
  const speechResult = form.get('SpeechResult')?.toString();
  const confidence = form.get('Confidence')?.toString();
  log.info('doctor response received', { communicationId, speechResult, confidence });

  if (communicationId && speechResult) {
    try {
      const medplum = await getAuthenticatedMedplumClient();
      const communication = await medplum.readResource('Communication', communicationId);
      await medplum.updateResource<Communication>({
        ...communication,
        status: 'completed',
        note: [{ text: speechResult }],
      });
      log.info('stored doctor response', { communicationId });
    } catch (err) {
      log.error('failed to store doctor response', err);
    }
  } else {
    log.warn('missing communicationId or speechResult, nothing stored');
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Got it, thank you.</Say></Response>`;
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
}
