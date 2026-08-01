import type { MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { placeOutboundAgentCall } from './twilio';
import { chartContextToText, gatherChartContext, type ChartContext } from './chart-context';
import { createLogger } from './logger';

const log = createLogger('lib/notify-doctor');

// Places a real conversational call to the on-call doctor -- connects to the same Deepgram Voice
// Agent tech as patient intake (via the phone-bridge), grounded in the patient's full chart, so
// the doctor can actually ask questions rather than just hear a one-way script.
//
// Guards against double-dialing: if a call for this patient is already in progress, skips instead
// of placing a second call (which just hits a busy signal and gets stuck with no way to complete).
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
  if (existing.length > 0) {
    log.warn('a doctor call is already in progress for this patient, skipping', { existingId: existing[0].id });
    return { skipped: true, reason: 'call already in progress' };
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
