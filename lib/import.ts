import type { MedplumClient } from '@medplum/core';
import type { AllergyIntolerance, Condition, Observation, Patient } from '@medplum/fhirtypes';

export interface ImportCondition {
  name: string;
  diagnosedDate?: string;
}

export interface ImportObservation {
  name: string;
  value: string | number;
  unit?: string;
  date?: string;
}

export interface ImportAllergy {
  substance: string;
  reaction?: string;
  severity?: 'mild' | 'moderate' | 'severe';
}

export interface ImportPatient {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  phone?: string;
  conditions?: ImportCondition[];
  observations?: ImportObservation[];
  allergies?: ImportAllergy[];
}

export interface ImportPayload {
  patients: ImportPatient[];
}

export interface ImportResult {
  patientId: string;
  firstName: string;
  lastName: string;
  conditionsCreated: number;
  observationsCreated: number;
  allergiesCreated: number;
}

export async function importPatients(medplum: MedplumClient, payload: ImportPayload): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  for (const p of payload.patients) {
    if (!p.firstName || !p.lastName) {
      throw new Error(`Patient missing firstName/lastName: ${JSON.stringify(p)}`);
    }

    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: [p.firstName], family: p.lastName }],
      ...(p.dateOfBirth ? { birthDate: p.dateOfBirth } : {}),
      ...(p.gender ? { gender: p.gender } : {}),
      ...(p.phone ? { telecom: [{ system: 'phone', value: p.phone }] } : {}),
    });

    for (const c of p.conditions ?? []) {
      await medplum.createResource<Condition>({
        resourceType: 'Condition',
        subject: { reference: `Patient/${patient.id}` },
        clinicalStatus: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
        },
        code: { text: c.name },
        ...(c.diagnosedDate ? { onsetDateTime: c.diagnosedDate } : {}),
      });
    }

    for (const o of p.observations ?? []) {
      const isNumeric = typeof o.value === 'number';
      await medplum.createResource<Observation>({
        resourceType: 'Observation',
        status: 'final',
        subject: { reference: `Patient/${patient.id}` },
        code: { text: o.name },
        ...(o.date ? { effectiveDateTime: o.date } : {}),
        ...(isNumeric
          ? { valueQuantity: { value: o.value as number, unit: o.unit, code: o.unit } }
          : { valueString: String(o.value) }),
      });
    }

    for (const a of p.allergies ?? []) {
      await medplum.createResource<AllergyIntolerance>({
        resourceType: 'AllergyIntolerance',
        patient: { reference: `Patient/${patient.id}` },
        clinicalStatus: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
        },
        code: { text: a.substance },
        ...(a.reaction
          ? { reaction: [{ manifestation: [{ text: a.reaction }], ...(a.severity ? { severity: a.severity } : {}) }] }
          : {}),
      });
    }

    results.push({
      patientId: patient.id as string,
      firstName: p.firstName,
      lastName: p.lastName,
      conditionsCreated: p.conditions?.length ?? 0,
      observationsCreated: p.observations?.length ?? 0,
      allergiesCreated: p.allergies?.length ?? 0,
    });
  }

  return results;
}
