import { MedplumClient } from '@medplum/core';
import type { AllergyIntolerance, Condition, Observation, Patient } from '@medplum/fhirtypes';

const medplum = new MedplumClient({
  baseUrl: process.env.MEDPLUM_BASE_URL,
  fetch: (url: string, options?: any) => fetch(url, options),
});

async function main(): Promise<void> {
  await medplum.startClientLogin(
    process.env.MEDPLUM_CLIENT_ID as string,
    process.env.MEDPLUM_CLIENT_SECRET as string
  );

  const patient = await medplum.createResource<Patient>({
    resourceType: 'Patient',
    name: [{ given: ['Maria'], family: 'Gonzalez' }],
    gender: 'female',
    birthDate: '1968-04-12',
    telecom: [{ system: 'phone', value: '+15551234567' }],
  });
  console.log('Created Patient:', patient.id);

  const conditions: Condition[] = await Promise.all(
    [
      { code: 'Type 2 diabetes mellitus', system: 'http://snomed.info/sct', sctCode: '44054006', onset: '2018-03-01' },
      { code: 'Essential hypertension', system: 'http://snomed.info/sct', sctCode: '59621000', onset: '2019-06-15' },
      { code: 'Hyperlipidemia', system: 'http://snomed.info/sct', sctCode: '55822004', onset: '2020-01-10' },
    ].map((c) =>
      medplum.createResource<Condition>({
        resourceType: 'Condition',
        subject: { reference: `Patient/${patient.id}` },
        clinicalStatus: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
        },
        code: { coding: [{ system: c.system, code: c.sctCode, display: c.code }], text: c.code },
        onsetDateTime: c.onset,
      })
    )
  );
  console.log(
    'Created Conditions:',
    conditions.map((c) => c.id)
  );

  const observation = await medplum.createResource<Observation>({
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: `Patient/${patient.id}` },
    code: {
      coding: [{ system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c' }],
      text: 'Hemoglobin A1c',
    },
    effectiveDateTime: '2026-06-15',
    valueQuantity: { value: 8.2, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
  });
  console.log('Created Observation (A1c 8.2):', observation.id);

  const allergy = await medplum.createResource<AllergyIntolerance>({
    resourceType: 'AllergyIntolerance',
    patient: { reference: `Patient/${patient.id}` },
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
    },
    code: {
      coding: [{ system: 'http://snomed.info/sct', code: '387406002', display: 'Sulfonamide' }],
      text: 'Sulfa drugs',
    },
    reaction: [{ manifestation: [{ text: 'Hives' }], severity: 'moderate' }],
  });
  console.log('Created AllergyIntolerance:', allergy.id);

  console.log('\nSEED_PATIENT_ID=' + patient.id);
  console.log('Add SEED_PATIENT_ID to .env.local for use in /intake and /clinician during dev.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
