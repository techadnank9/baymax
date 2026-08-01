import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { placeOutboundCallWithResponse } from '@/lib/twilio';
import { DIFFERENTIAL_ITEMS_EXTENSION_URL, type DifferentialItem } from '@/lib/fhir-writes';
import { createLogger } from '@/lib/logger';
import type { Communication } from '@medplum/fhirtypes';

const log = createLogger('api/notify-doctor');

function buildScript(
  patientName: string,
  conditions: string[],
  observations: string[],
  allergies: string[],
  differential: DifferentialItem[],
  redFlags: string[],
  coverage: string | undefined
): string {
  const parts: string[] = [`Hi Doctor, calling with a briefing on patient ${patientName}.`];

  if (conditions.length) {
    parts.push(`Known conditions: ${conditions.join(', ')}.`);
  }
  if (observations.length) {
    parts.push(`Symptoms and observations from today's intake: ${observations.join(', ')}.`);
  }
  if (allergies.length) {
    parts.push(`Allergies: ${allergies.join(', ')}.`);
  }
  if (differential.length) {
    const top = differential[0];
    parts.push(`Top differential consideration is ${top.condition}, ${top.likelihood} likelihood. ${top.rationale}`);
    if (top.suggestedNextSteps) {
      parts.push(`Suggested next step: ${top.suggestedNextSteps}`);
    }
  }
  if (redFlags.length) {
    parts.push(`Red flag alert: ${redFlags.join('. ')}. This needs urgent attention.`);
  }
  if (coverage) {
    parts.push(`Coverage: ${coverage}.`);
  }

  return parts.join(' ');
}

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId } = await req.json();
  log.info('request', { patientId });

  if (!patientId) {
    return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
  }
  const doctorPhone = process.env.DOCTOR_PHONE_NUMBER;
  if (!doctorPhone) {
    return NextResponse.json({ error: 'DOCTOR_PHONE_NUMBER not configured' }, { status: 500 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
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

    const script = buildScript(
      patientName,
      conditions.map((c) => c.code?.text ?? c.code?.coding?.[0]?.display ?? 'condition'),
      observations.map(
        (o) => `${o.code?.text ?? 'observation'} ${o.valueQuantity?.value ?? o.valueString ?? ''}${o.valueQuantity?.unit ?? ''}`
      ),
      allergies.map((a) => a.code?.text ?? a.code?.coding?.[0]?.display ?? 'allergy'),
      differential,
      tasks.map((t) => t.description ?? ''),
      coverages[0] ? `${coverages[0].status}, ${coverages[0].class?.[0]?.name ?? ''}` : undefined
    );
    log.info('call script', { script });

    // Placeholder Communication so the dashboard has something to poll immediately;
    // updated with the CallSid right after, and with the doctor's reply by the webhook.
    const communication = await medplum.createResource<Communication>({
      resourceType: 'Communication',
      status: 'in-progress',
      subject: { reference: `Patient/${patientId}` },
      sent: new Date().toISOString(),
      payload: [{ contentString: script }],
      note: [{ text: '[waiting for doctor response]' }],
    });

    const origin = new URL(req.url).origin;
    const webhookUrl = `${origin}/api/twilio/doctor-response?communicationId=${communication.id}`;
    const result = await placeOutboundCallWithResponse(doctorPhone, script, webhookUrl);
    log.info('call placed', { sid: result.sid, communicationId: communication.id });

    await medplum.updateResource<Communication>({
      ...communication,
      identifier: [{ system: 'https://api.twilio.com/callSid', value: result.sid }],
    });

    return NextResponse.json({ communicationId: communication.id, callSid: result.sid, script });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
