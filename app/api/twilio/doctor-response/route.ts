import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';
import type { Communication } from '@medplum/fhirtypes';

const log = createLogger('api/twilio/doctor-response');

// Twilio POSTs here (form-encoded) once the Gather step ends -- either because the doctor spoke
// (SpeechResult present) or because it timed out with no input (actionOnEmptyResult="true"
// guarantees this webhook still fires in that case, so the dashboard never hangs on "Waiting...").
// The response body IS TwiML spoken back to the doctor to close out the call.
export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const communicationId = url.searchParams.get('communicationId');
  const form = await req.formData();
  const speechResult = form.get('SpeechResult')?.toString();
  const confidence = form.get('Confidence')?.toString();
  log.info('gather result received', { communicationId, speechResult, confidence });

  let closingMessage = 'Got it, thank you. Goodbye.';

  if (communicationId) {
    try {
      const medplum = await getAuthenticatedMedplumClient();
      const communication = await medplum.readResource('Communication', communicationId);
      await medplum.updateResource<Communication>({
        ...communication,
        status: 'completed',
        note: [{ text: speechResult || '[no response captured -- call ended without a spoken reply]' }],
      });
      log.info('stored gather result', { communicationId, hadSpeech: Boolean(speechResult) });
    } catch (err) {
      log.error('failed to store gather result', err);
    }
  } else {
    log.warn('missing communicationId, nothing stored');
  }

  if (!speechResult) {
    closingMessage = "We didn't catch a response. Goodbye.";
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${closingMessage}</Say></Response>`;
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
}
