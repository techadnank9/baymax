import type { MedplumClient } from '@medplum/core';
import type { AllergyIntolerance, ClinicalImpression, Condition, Coverage, Observation, Task } from '@medplum/fhirtypes';

export interface ChartObservationInput {
  patientId: string;
  encounterId: string;
  type: 'observation' | 'condition' | 'allergy';
  value: string;
  code?: string;
}

// NOTE: spec calls for this write to go through a Medplum Bot (auditable, standards-compliant).
// Hosted app.medplum.com has Bots disabled by default and creating one returned 403 Forbidden
// (Medplum docs: "Bots are disabled by default for accounts. Contact info@medplum.com.").
// Writing directly here to protect the demo spine; swap for a Bot invocation if that's enabled.
export async function chartObservation(
  medplum: MedplumClient,
  input: ChartObservationInput
): Promise<Observation | Condition | AllergyIntolerance> {
  const { patientId, encounterId, type, value, code } = input;
  const subject = { reference: `Patient/${patientId}` };
  const encounter = { reference: `Encounter/${encounterId}` };

  if (type === 'condition') {
    return medplum.createResource<Condition>({
      resourceType: 'Condition',
      subject,
      encounter,
      clinicalStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
      },
      code: { text: value, ...(code ? { coding: [{ system: 'http://snomed.info/sct', code }] } : {}) },
    });
  }

  if (type === 'allergy') {
    return medplum.createResource<AllergyIntolerance>({
      resourceType: 'AllergyIntolerance',
      patient: subject,
      encounter,
      clinicalStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
      },
      code: { text: value, ...(code ? { coding: [{ system: 'http://snomed.info/sct', code }] } : {}) },
    });
  }

  return medplum.createResource<Observation>({
    resourceType: 'Observation',
    status: 'final',
    subject,
    encounter,
    code: { text: value, ...(code ? { coding: [{ system: 'http://loinc.org', code }] } : {}) },
    valueString: value,
  });
}

export interface DifferentialItem {
  condition: string;
  likelihood: string;
  rationale: string;
  citations: string[];
  suggestedNextSteps?: string;
}

// Custom extension carrying the structured differential (likelihood, citations, suggested next
// steps) so the clinician screen can render a chart + treatment panel without parsing free text.
// The summary/finding fields above stay standard FHIR for any other consumer.
export const DIFFERENTIAL_ITEMS_EXTENSION_URL = 'https://agentic-intake.example/fhir/StructureDefinition/differential-items';

export async function writeDifferential(
  medplum: MedplumClient,
  patientId: string,
  encounterId: string,
  differentials: DifferentialItem[]
): Promise<ClinicalImpression> {
  return medplum.createResource<ClinicalImpression>({
    resourceType: 'ClinicalImpression',
    status: 'completed',
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    summary: differentials.map((d) => `${d.condition} (${d.likelihood}): ${d.rationale}`).join('\n'),
    finding: differentials.map((d) => ({
      itemCodeableConcept: { text: d.condition },
      basis: [
        d.rationale,
        ...(d.citations ?? []),
        d.suggestedNextSteps ? `Suggested next steps: ${d.suggestedNextSteps}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    })),
    extension: [{ url: DIFFERENTIAL_ITEMS_EXTENSION_URL, valueString: JSON.stringify(differentials) }],
  });
}

export interface CoverageResult {
  covered: boolean;
  copay: number;
  planName: string;
}

export async function writeCoverage(
  medplum: MedplumClient,
  patientId: string,
  result: CoverageResult
): Promise<Coverage> {
  return medplum.createResource<Coverage>({
    resourceType: 'Coverage',
    status: result.covered ? 'active' : 'cancelled',
    beneficiary: { reference: `Patient/${patientId}` },
    payor: [{ display: result.planName }],
    class: [{ type: { text: 'copay' }, value: String(result.copay), name: `$${result.copay} copay` }],
  });
}

export async function createRedFlagTask(
  medplum: MedplumClient,
  patientId: string,
  encounterId: string,
  finding: string,
  action: string
): Promise<Task> {
  return medplum.createResource<Task>({
    resourceType: 'Task',
    status: 'requested',
    intent: 'proposal',
    for: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    description: `${finding} -- ${action}`,
  });
}
