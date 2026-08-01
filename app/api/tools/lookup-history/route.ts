import { NextResponse } from 'next/server';
import { getMossClient, historyIndexName } from '@/lib/moss';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/tools/lookup-history');

export async function POST(req: Request): Promise<NextResponse> {
  const { patientId, query } = await req.json();
  log.info('request', { patientId, query });

  if (!patientId || !query) {
    log.warn('missing required fields', { patientId, query });
    return NextResponse.json({ error: 'patientId and query are required' }, { status: 400 });
  }

  try {
    const moss = await getMossClient();
    const index = historyIndexName(patientId);
    // moss's cloud /query endpoint has been unreliable (503s) even when the index is Ready;
    // loadIndex() + local in-memory query avoids that round-trip entirely.
    await moss.loadIndex(index);
    const results = await moss.query(index, query, { topK: 3 });
    log.info('moss query ok', { docCount: results.docs.length });

    return NextResponse.json({
      snippets: results.docs.map((d) => d.text),
    });
  } catch (err) {
    log.warn('moss query failed, falling back to Medplum search', err);
    try {
      const medplum = await getAuthenticatedMedplumClient();
      const [conditions, observations] = await Promise.all([
        medplum.searchResources('Condition', `subject=Patient/${patientId}`),
        medplum.searchResources('Observation', `subject=Patient/${patientId}`),
      ]);
      const snippets = [
        ...conditions.map((c) => c.code?.text ?? c.code?.coding?.[0]?.display ?? 'condition on file'),
        ...observations.map(
          (o) => `${o.code?.text ?? 'observation'}: ${o.valueQuantity?.value ?? o.valueString ?? ''}`
        ),
      ];
      log.info('fallback search ok', { count: snippets.length });
      return NextResponse.json({ snippets });
    } catch (fallbackErr) {
      log.error('fallback search also failed', fallbackErr);
      return NextResponse.json({ error: (fallbackErr as Error).message }, { status: 500 });
    }
  }
}
