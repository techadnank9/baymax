import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';
import type { Communication } from '@medplum/fhirtypes';

const log = createLogger('api/twilio/call-status');

const FAILURE_STATUSES = new Set(['busy', 'failed', 'no-answer', 'canceled']);

// Twilio POSTs here on call completion (any reason). Only acts if the call never actually
// connected -- e.g. busy signal -- which otherwise leaves the Communication stuck "in-progress"
// forever, since <Stream> never ran and phone-bridge never got a chance to post a transcript.
export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const communicationId = url.searchParams.get('communicationId');
  const form = await req.formData();
  const callStatus = form.get('CallStatus')?.toString();
  log.info('status callback', { communicationId, callStatus });

  if (communicationId && callStatus && FAILURE_STATUSES.has(callStatus)) {
    try {
      const medplum = await getAuthenticatedMedplumClient();
      const communication = await medplum.readResource('Communication', communicationId);
      if (communication.status === 'in-progress') {
        await medplum.updateResource<Communication>({
          ...communication,
          status: 'completed',
          note: [{ text: `[call did not connect: ${callStatus}]` }],
        });
        log.info('marked failed call complete', { communicationId, callStatus });
      }
    } catch (err) {
      log.error('failed to update communication for failed call', err);
    }
  }

  // The Fetch API spec forbids any body -- even an empty string -- on a 204 response; passing
  // one throws at runtime (this is what caused Twilio to see an HTTP 500 here).
  return new NextResponse(null, { status: 204 });
}
