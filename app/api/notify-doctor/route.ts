import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { placeDoctorBriefingCall } from '@/lib/notify-doctor';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/notify-doctor');

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId } = await req.json();
  log.info('request', { patientId });

  if (!patientId) {
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const result = await placeDoctorBriefingCall(medplum, patientId);
    return NextResponse.json(result);
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
