import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { findPatientsByName } from '@/lib/patients';
import { createLogger } from '@/lib/logger';
import type { Patient } from '@medplum/fhirtypes';

const log = createLogger('api/tools/identify-patient');

function splitName(fullName: string): { given: string[]; family: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { given: [parts[0]], family: 'Unknown' };
  }
  return { given: parts.slice(0, -1), family: parts[parts.length - 1] };
}

export async function POST(req: Request): Promise<NextResponse> {
  const { name } = await req.json();
  log.info('request', { name });

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const matches = await findPatientsByName(medplum, name);

    if (matches.length > 1) {
      log.warn('multiple matches', { count: matches.length });
      return NextResponse.json({
        status: 'multiple',
        matches,
        confirmation: `I found ${matches.length} people with that name -- can you give me your date of birth to narrow it down?`,
      });
    }

    if (matches.length === 1) {
      const match = matches[0];
      log.info('identified existing patient', { id: match.id });
      return NextResponse.json({
        status: 'confirmed',
        id: match.id,
        firstName: match.firstName,
        lastName: match.lastName,
        isNew: false,
        confirmation: `Confirmed patient: ${match.firstName} ${match.lastName}.`,
      });
    }

    // No existing record -- register them on the spot rather than turning them away.
    const { given, family } = splitName(name);
    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given, family }],
    });
    log.info('registered new patient', { id: patient.id, given, family });

    return NextResponse.json({
      status: 'confirmed',
      id: patient.id,
      firstName: given[0],
      lastName: family,
      isNew: true,
      confirmation: `New patient record created for ${given.join(' ')} ${family}.`,
    });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
