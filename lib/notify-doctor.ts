import type { MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { placeOutboundAgentCall } from './twilio';
import { chartContextToText, gatherChartContext } from './chart-context';
import { createLogger } from './logger';

const log = createLogger('lib/notify-doctor');

// Places a real conversational call to the on-call doctor -- connects to the same Deepgram Voice
// Agent tech as patient intake (via the phone-bridge), grounded in the patient's full chart, so
// the doctor can actually ask questions rather than just hear a one-way script.
export async function notifyDoctorOfCompletedIntake(medplum: MedplumClient, patientId: string): Promise<void> {
  const doctorPhone = process.env.DOCTOR_PHONE_NUMBER;
  const phoneBridgeWssUrl = process.env.PHONE_BRIDGE_WSS_URL;
  if (!doctorPhone || !phoneBridgeWssUrl) {
    log.warn('DOCTOR_PHONE_NUMBER or PHONE_BRIDGE_WSS_URL not set, skipping notification call');
    return;
  }

  const ctx = await gatherChartContext(medplum, patientId);
  const briefingText = chartContextToText(ctx);
  log.info('notifying doctor', { patientName: ctx.patientName, urgent: ctx.redFlags.length > 0 });

  const communication = await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: { reference: `Patient/${patientId}` },
    sent: new Date().toISOString(),
    payload: [{ contentString: briefingText }],
    note: [{ text: '[call in progress]' }],
  });

  const streamUrl = `${phoneBridgeWssUrl}/stream?mode=doctor&patientId=${patientId}&communicationId=${communication.id}`;
  const result = await placeOutboundAgentCall(doctorPhone, streamUrl);
  log.info('doctor notification call placed', { sid: result.sid, communicationId: communication.id });

  await medplum.updateResource<Communication>({
    ...communication,
    identifier: [{ system: 'https://api.twilio.com/callSid', value: result.sid }],
  });
}
