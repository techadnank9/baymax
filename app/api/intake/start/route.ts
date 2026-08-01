import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';
import type { Encounter } from '@medplum/fhirtypes';

const log = createLogger('api/intake/start');

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId } = await req.json();
  log.info('request', { patientId });

  if (!patientId) {
    log.warn('missing patientId');
    return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const encounter = await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
      subject: { reference: `Patient/${patientId}` },
    });
    log.info('encounter created', { encounterId: encounter.id });

    return NextResponse.json({ encounterId: encounter.id });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
