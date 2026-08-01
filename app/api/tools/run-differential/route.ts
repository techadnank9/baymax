import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { generateText } from '@/lib/llm-gateway';
import { writeDifferential, type DifferentialItem } from '@/lib/fhir-writes';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/tools/run-differential');

const PROMPT_INSTRUCTIONS = `You are a clinical decision-support assistant. Given a patient's charted
symptoms, conditions, and history below, produce a ranked differential diagnosis FOR THE CLINICIAN
to review before they see the patient -- this is decision support, not a prescription, and the
clinician makes the final call.

Respond with STRICT JSON only -- no prose, no markdown fences. Shape exactly:
{"differentials": [{"condition": string, "likelihood": "high"|"medium"|"low", "rationale": string, "citations": string[], "suggestedNextSteps": string}]}

List 2-4 differentials, most likely first. Keep rationale to one sentence. Citations should be
short references (e.g. guideline names or "ADA 2024 Standards of Care") -- use [] if none apply.
suggestedNextSteps is one short sentence of what the clinician might consider ordering or doing to
confirm/rule out that condition (e.g. "Rapid strep test; supportive care if negative") -- phrase it
as a suggestion for the clinician to evaluate, never as an instruction already given to the patient.`;

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId, encounterId } = await req.json();
  log.info('request', { patientId, encounterId });

  if (!patientId || !encounterId) {
    log.warn('missing required fields', { patientId, encounterId });
    return NextResponse.json({ error: 'patientId and encounterId are required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const [conditions, observations, allergies] = await Promise.all([
      medplum.searchResources('Condition', `subject=Patient/${patientId}`),
      medplum.searchResources('Observation', `subject=Patient/${patientId}`),
      medplum.searchResources('AllergyIntolerance', `patient=Patient/${patientId}`),
    ]);

    const chartSummary = [
      'Conditions: ' + conditions.map((c) => c.code?.text ?? c.code?.coding?.[0]?.display).join(', '),
      'Observations: ' +
        observations
          .map((o) => `${o.code?.text ?? ''} ${o.valueQuantity?.value ?? o.valueString ?? ''}${o.valueQuantity?.unit ?? ''}`)
          .join(', '),
      'Allergies: ' + allergies.map((a) => a.code?.text ?? a.code?.coding?.[0]?.display).join(', '),
    ].join('\n');
    log.info('chart summary', { chartSummary });

    let parsed: { differentials: DifferentialItem[] };

    if (!process.env.AI_GATEWAY_KEY) {
      log.warn('AI_GATEWAY_KEY not set, using stubbed differential');
      parsed = {
        differentials: conditions.slice(0, 3).map((c, i) => ({
          condition: c.code?.text ?? c.code?.coding?.[0]?.display ?? 'Unknown condition',
          likelihood: i === 0 ? 'high' : i === 1 ? 'medium' : 'low',
          rationale: '[STUBBED -- AI_GATEWAY_KEY not configured, derived directly from problem list]',
          citations: [],
          suggestedNextSteps: '[STUBBED -- no suggestion available]',
        })),
      };
    } else {
      const text = await generateText(PROMPT_INSTRUCTIONS, chartSummary);
      log.info('gateway raw response', { text });
      parsed = JSON.parse(text) as { differentials: DifferentialItem[] };
    }

    const clinicalImpression = await writeDifferential(medplum, patientId, encounterId, parsed.differentials);
    log.info('wrote ClinicalImpression', { id: clinicalImpression.id });

    return NextResponse.json({
      id: clinicalImpression.id,
      differentials: parsed.differentials,
      confirmation: `Differential recorded: top consideration is ${parsed.differentials[0]?.condition}`,
    });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
