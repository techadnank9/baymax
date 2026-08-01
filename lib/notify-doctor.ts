import type { MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { placeOutboundAgentCall } from './twilio';
import { chartContextToText, gatherChartContext, type ChartContext } from './chart-context';
import { createLogger } from './logger';

const log = createLogger('lib/notify-doctor');

// A call genuinely can't take longer than this to at least connect and get a first response --
// anything older than this that's still "in-progress" means something failed silently (busy
// signal that dodged the status callback, cold-start timeout, crashed phone-bridge, etc.) and
// should no longer block a new call for the same patient.
const STUCK_CALL_TIMEOUT_MS = 2 * 60 * 1000;

// Places a real conversational call to the on-call doctor -- connects to the same Deepgram Voice
// Agent tech as patient intake (via the phone-bridge), grounded in the patient's full chart, so
// the doctor can actually ask questions rather than just hear a one-way script.
//
// Guards against double-dialing: if a call for this patient started less than 2 minutes ago and is
// still in progress, skips (a second call right now would just hit a busy signal). If that call
// is older than 2 minutes, it's treated as failed/abandoned -- marked completed with a timeout
// note -- and a new call is placed instead of blocking forever.
export async function placeDoctorBriefingCall(
  medplum: MedplumClient,
  patientId: string,
  opts: { briefingLabel?: string; ctx?: ChartContext } = {}
): Promise<{ skipped: true; reason: string } | { skipped: false; communicationId: string; callSid: string }> {
  const doctorPhone = process.env.DOCTOR_PHONE_NUMBER;
  const phoneBridgeWssUrl = process.env.PHONE_BRIDGE_WSS_URL;
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!doctorPhone || !phoneBridgeWssUrl) {
    log.warn('DOCTOR_PHONE_NUMBER or PHONE_BRIDGE_WSS_URL not set, skipping notification call');
    return { skipped: true, reason: 'not configured' };
  }

  const existing = await medplum.searchResources('Communication', `subject=Patient/${patientId}&status=in-progress`);
  for (const stale of existing) {
    const ageMs = Date.now() - new Date(stale.sent ?? stale.meta?.lastUpdated ?? 0).getTime();
    if (ageMs < STUCK_CALL_TIMEOUT_MS) {
      log.warn('a doctor call is already in progress for this patient, skipping', { existingId: stale.id, ageMs });
      return { skipped: true, reason: 'call already in progress' };
    }
    log.warn('found a stale in-progress call, marking it timed out', { staleId: stale.id, ageMs });
    await medplum.updateResource<Communication>({
      ...stale,
      status: 'completed',
      note: [{ text: '[call timed out -- no response within 2 minutes, likely never connected]' }],
    });
  }

  const ctx = opts.ctx ?? (await gatherChartContext(medplum, patientId));
  const briefingText = opts.briefingLabel ? `${opts.briefingLabel}\n${chartContextToText(ctx)}` : chartContextToText(ctx);
  log.info('notifying doctor', { patientName: ctx.patientName, urgent: ctx.redFlags.length > 0 });

  const communication = await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: { reference: `Patient/${patientId}` },
    sent: new Date().toISOString(),
    payload: [{ contentString: briefingText }],
    note: [{ text: '[call in progress]' }],
  });

  const statusParams: Record<string, string> = { mode: 'doctor', patientId, communicationId: communication.id as string };
  const result = await placeOutboundAgentCall(
    doctorPhone,
    `${phoneBridgeWssUrl}/stream`,
    statusParams,
    appBaseUrl ? `${appBaseUrl}/api/twilio/call-status?communicationId=${communication.id}` : undefined
  );
  log.info('doctor notification call placed', { sid: result.sid, communicationId: communication.id });

  await medplum.updateResource<Communication>({
    ...communication,
    identifier: [{ system: 'https://api.twilio.com/callSid', value: result.sid }],
  });

  return { skipped: false, communicationId: communication.id as string, callSid: result.sid };
}

export async function notifyDoctorOfCompletedIntake(medplum: MedplumClient, patientId: string): Promise<void> {
  await placeDoctorBriefingCall(medplum, patientId);
}
