import { MedplumClient } from '@medplum/core';
import { getMossClient, historyIndexName } from '../lib/moss';

const medplum = new MedplumClient({
  baseUrl: process.env.MEDPLUM_BASE_URL,
  fetch: (url: string, options?: any) => fetch(url, options),
});

async function main(): Promise<void> {
  const patientId = process.env.SEED_PATIENT_ID as string;
  if (!patientId) {
    throw new Error('SEED_PATIENT_ID not set');
  }

  await medplum.startClientLogin(
    process.env.MEDPLUM_CLIENT_ID as string,
    process.env.MEDPLUM_CLIENT_SECRET as string
  );

  const [conditions, observations, allergies] = await Promise.all([
    medplum.searchResources('Condition', `subject=Patient/${patientId}`),
    medplum.searchResources('Observation', `subject=Patient/${patientId}`),
    medplum.searchResources('AllergyIntolerance', `patient=Patient/${patientId}`),
  ]);

  const docs = [
    ...conditions.map((c) => ({
      id: `condition-${c.id}`,
      text: `History: ${c.code?.text ?? c.code?.coding?.[0]?.display} (diagnosed ${c.onsetDateTime ?? 'unknown date'})`,
    })),
    ...observations.map((o) => ({
      id: `observation-${o.id}`,
      text: `Past result: ${o.code?.text ?? o.code?.coding?.[0]?.display} = ${o.valueQuantity?.value ?? ''}${o.valueQuantity?.unit ?? ''} on ${o.effectiveDateTime ?? 'unknown date'}`,
    })),
    ...allergies.map((a) => ({
      id: `allergy-${a.id}`,
      text: `Allergy: ${a.code?.text ?? a.code?.coding?.[0]?.display}, reaction: ${a.reaction?.[0]?.manifestation?.[0]?.text ?? 'unspecified'}`,
    })),
  ];

  console.log(`Indexing ${docs.length} documents for patient ${patientId}...`);
  docs.forEach((d) => console.log(' -', d.text));

  const moss = await getMossClient();
  const indexName = historyIndexName(patientId);
  await moss.createIndex(indexName, docs, {
    onProgress: (p) => console.log(`  ${p.status} ${p.progress}%`),
  });

  console.log(`Indexed into moss index "${indexName}".`);
}

main().catch((err) => {
  console.error('moss indexing failed:', err);
  process.exit(1);
});
