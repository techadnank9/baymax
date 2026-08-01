import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/tasks/approve');

export async function POST(req: Request): Promise<NextResponse> {
  const { taskId } = await req.json();
  log.info('request', { taskId });

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const task = await medplum.readResource('Task', taskId);
    const updated = await medplum.updateResource({ ...task, status: 'accepted' });
    log.info('approved', { id: updated.id });
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
