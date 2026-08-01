import type { MedplumClient } from '@medplum/core';
import { DIFFERENTIAL_ITEMS_EXTENSION_URL, type DifferentialItem } from './fhir-writes';

export interface ChartContext {
  patientName: string;
  conditions: string[];
  observations: string[];
  allergies: string[];
  differential: DifferentialItem[];
  redFlags: string[];
  coverage: string | undefined;
}

export async function gatherChartContext(medplum: MedplumClient, patientId: string): Promise<ChartContext> {
  const patient = await medplum.readResource('Patient', patientId);
  const patientName = `${patient.name?.[0]?.given?.[0] ?? ''} ${patient.name?.[0]?.family ?? ''}`.trim() || 'the patient';

  const [conditions, observations, allergies, impressions, tasks, coverages] = await Promise.all([
    medplum.searchResources('Condition', `subject=Patient/${patientId}`),
    medplum.searchResources('Observation', `subject=Patient/${patientId}`),
    medplum.searchResources('AllergyIntolerance', `patient=Patient/${patientId}`),
    medplum.searchResources('ClinicalImpression', `subject=Patient/${patientId}&_sort=-_lastUpdated&_count=1`),
    medplum.searchResources('Task', `patient=Patient/${patientId}&status=requested`),
    medplum.searchResources('Coverage', `beneficiary=Patient/${patientId}`),
  ]);

  let differential: DifferentialItem[] = [];
  const ext = impressions[0]?.extension?.find((e) => e.url === DIFFERENTIAL_ITEMS_EXTENSION_URL);
  if (ext?.valueString) {
    try {
      differential = JSON.parse(ext.valueString);
    } catch {
      // ignore
    }
  }

  return {
    patientName,
    conditions: conditions.map((c) => c.code?.text ?? c.code?.coding?.[0]?.display ?? 'condition'),
    observations: observations.map((o) => {
      const label = o.code?.text ?? 'observation';
      // chartObservation stores free-text symptoms in both code.text and valueString
      // identically -- don't repeat the same phrase twice when they match.
      if (o.valueQuantity?.value !== undefined) {
        return `${label} ${o.valueQuantity.value}${o.valueQuantity.unit ?? ''}`;
      }
      if (o.valueString && o.valueString !== label) {
        return `${label}: ${o.valueString}`;
      }
      return label;
    }),
    allergies: allergies.map((a) => a.code?.text ?? a.code?.coding?.[0]?.display ?? 'allergy'),
    differential,
    redFlags: tasks.map((t) => t.description ?? ''),
    coverage: coverages[0] ? `${coverages[0].status}, ${coverages[0].class?.[0]?.name ?? ''}` : undefined,
  };
}

export function chartContextToText(ctx: ChartContext): string {
  const lines: string[] = [];
  if (ctx.conditions.length) {
    lines.push(`Known conditions: ${ctx.conditions.join(', ')}.`);
  }
  if (ctx.observations.length) {
    lines.push(`Symptoms and observations from today's intake: ${ctx.observations.join(', ')}.`);
  }
  if (ctx.allergies.length) {
    lines.push(`Allergies: ${ctx.allergies.join(', ')}.`);
  }
  if (ctx.differential.length) {
    const top = ctx.differential[0];
    lines.push(`Top differential consideration: ${top.condition} (${top.likelihood} likelihood). ${top.rationale}`);
    if (top.suggestedNextSteps) {
      lines.push(`Suggested next step: ${top.suggestedNextSteps}`);
    }
    if (ctx.differential.length > 1) {
      lines.push(`Other considerations: ${ctx.differential.slice(1).map((d) => `${d.condition} (${d.likelihood})`).join(', ')}.`);
    }
  }
  if (ctx.redFlags.length) {
    lines.push(`RED FLAG: ${ctx.redFlags.join('. ')}. This needs urgent attention.`);
  }
  if (ctx.coverage) {
    lines.push(`Coverage: ${ctx.coverage}.`);
  }
  return lines.length ? lines.join('\n') : 'No chart data recorded yet for this patient.';
}
