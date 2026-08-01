import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createRedFlagTask } from '@/lib/fhir-writes';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/tools/flag-red-flag');

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId, encounterId, finding, action } = await req.json();
  log.info('request', { patientId, encounterId, finding, action });

  if (!patientId || !encounterId || !finding || !action) {
    log.warn('missing required fields', { patientId, encounterId, finding, action });
    return NextResponse.json({ error: 'patientId, encounterId, finding, and action are required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const task = await createRedFlagTask(medplum, patientId, encounterId, finding, action);
    log.info('wrote Task', { id: task.id });

    return NextResponse.json({
      id: task.id,
      confirmation: `Flagged for clinician review: ${finding}`,
    });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
