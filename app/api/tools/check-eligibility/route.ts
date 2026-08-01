import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { checkEligibility } from '@/lib/stedi';
import { writeCoverage } from '@/lib/fhir-writes';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/tools/check-eligibility');

// EQ01 service type code(s) to check. "30" (Health Benefit Plan Coverage) is the general-purpose
// code that returns the broadest set of benefits -- add more specific codes here (e.g. "1"
// Medical Care, "88" Pharmacy, "98" Professional (Physician) Visit - Office) if a narrower check
// is ever needed for a specific service type.
const DEFAULT_SERVICE_TYPE_CODES = ['30'];

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId, serviceTypeCodes } = await req.json();
  log.info('request', { patientId, serviceTypeCodes });

  if (!patientId) {
    log.warn('missing patientId');
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const patient = await medplum.readResource('Patient', patientId);
    const name = patient.name?.[0];

    const result = await checkEligibility({
      tradingPartnerServiceId: '00540',
      provider: { npi: '1234567890', organizationName: 'Agentic Intake Clinic' },
      subscriber: {
        memberId: patientId,
        firstName: name?.given?.[0] ?? 'Unknown',
        lastName: name?.family ?? 'Unknown',
        dateOfBirth: (patient.birthDate ?? '1970-01-01').replace(/-/g, ''),
      },
      encounter: { serviceTypeCodes: serviceTypeCodes ?? DEFAULT_SERVICE_TYPE_CODES },
    });
    if (result.stubbed) {
      log.warn('stedi returned an AAA error, using stubbed coverage', result);
    } else {
      log.info('stedi result', result);
    }

    const coverage = await writeCoverage(medplum, patientId, result);
    log.info('wrote Coverage', { id: coverage.id });

    return NextResponse.json({
      covered: result.covered,
      copay: result.copay,
      planName: result.planName,
      confirmation: result.covered
        ? `Covered, copay is $${result.copay}`
        : 'Coverage could not be verified',
    });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
