import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { notifyDoctorOfCompletedIntake } from '@/lib/notify-doctor';
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

    const patientId = encounter.subject?.reference?.split('/')[1];
    if (patientId) {
      notifyDoctorOfCompletedIntake(medplum, patientId).catch((err) =>
        log.error('doctor notification failed (non-blocking)', err)
      );
    }

    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
