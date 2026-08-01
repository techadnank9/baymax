import { NextResponse } from 'next/server';
import { getAuthenticatedMedplumClient } from '@/lib/medplum';
import { ingestRobotIncident, type RobotIncidentPayload } from '@/lib/robot-monitor';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/robot/monitor-event');

export async function POST(req: Request): Promise<NextResponse> {
  const payload = (await req.json()) as RobotIncidentPayload;
  log.info('request', payload);

  if (!payload.roomId || !payload.patientId || !payload.incidentType || !payload.severity) {
    return NextResponse.json(
      { error: 'roomId, patientId, incidentType, and severity are required' },
      { status: 400 }
    );
  }

  try {
    const medplum = await getAuthenticatedMedplumClient();
    const result = await ingestRobotIncident(medplum, payload);
    log.info('ingested', result);
    return NextResponse.json({
      ...result,
      dashboardUrl: `/clinician?patientId=${result.patientId}`,
    });
  } catch (err) {
    log.error('failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
