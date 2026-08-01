import type { MedplumClient } from '@medplum/core';

export interface PatientMatch {
  id: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
}

export async function findPatientsByName(medplum: MedplumClient, name: string): Promise<PatientMatch[]> {
  const patients = await medplum.searchResources('Patient', `name=${encodeURIComponent(name.trim())}`);
  return patients.map((p) => ({
    id: p.id as string,
    firstName: p.name?.[0]?.given?.[0] ?? '',
    lastName: p.name?.[0]?.family ?? '',
    birthDate: p.birthDate,
  }));
}
