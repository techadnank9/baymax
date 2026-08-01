import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { importPatients, type ImportPayload } from '@/lib/import';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/admin/import');

export async function POST(req: Request): Promise<NextResponse> {
  const payload = (await req.json()) as ImportPayload;
  log.info('request', { patientCount: payload.patients?.length });

  if (!Array.isArray(payload.patients) || payload.patients.length === 0) {
    return NextResponse.json({ error: 'payload.patients must be a non-empty array' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const results = await importPatients(medplum, payload);
    log.info('import complete', { count: results.length });
    return NextResponse.json({ imported: results });
  } catch (err) {
    log.error('import failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
