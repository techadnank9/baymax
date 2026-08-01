import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';
import type { Encounter } from '@medplum/fhirtypes';

const log = createLogger('api/intake/end');

export async function POST(req: Request): Promise<NextResponse> {
  const { encounterId } = await req.json();
  log.info('request', { encounterId });

  if (!encounterId) {
    return NextResponse.json({ error: 'encounterId is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const encounter = await medplum.readResource('Encounter', encounterId);
    const updated = await medplum.updateResource<Encounter>({
      ...encounter,
      status: 'finished',
      period: { ...encounter.period, end: new Date().toISOString() },
    });
    log.info('encounter finished', { id: updated.id });
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
