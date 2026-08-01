import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { findPatientsByName } from '@/lib/patients';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/patients/lookup');

export async function POST(req: Request): Promise<NextResponse> {
  const { name } = await req.json();
  log.info('request', { name });

  if (!name || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const matches = await findPatientsByName(medplum, name);

    if (matches.length === 0) {
      log.warn('no patient found for name', { name });
      return NextResponse.json({ error: 'No patient record found with that name' }, { status: 404 });
    }

    log.info('found matches', { count: matches.length });
    return NextResponse.json({ matches });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
