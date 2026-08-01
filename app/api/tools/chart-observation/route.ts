import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { chartObservation } from '@/lib/fhir-writes';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/tools/chart-observation');

export async function POST(req: Request): Promise<NextResponse> {
  const input = await req.json();
  log.info('request', input);

  if (!input.patientId || !input.encounterId || !input.type || !input.value) {
    log.warn('missing required fields', input);
    return NextResponse.json({ error: 'patientId, encounterId, type, and value are required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const resource = await chartObservation(medplum, input);
    log.info('wrote resource', { id: resource.id, resourceType: resource.resourceType });

    return NextResponse.json({
      id: resource.id,
      resourceType: resource.resourceType,
      confirmation: `Charted ${input.type}: ${input.value}`,
    });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
