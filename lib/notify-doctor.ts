import type { MedplumClient } from '@medplum/core';
import { DIFFERENTIAL_ITEMS_EXTENSION_URL, type DifferentialItem } from './fhir-writes';
import { placeOutboundNotificationCall } from './twilio';
import { createLogger } from './logger';

const log = createLogger('lib/notify-doctor');

export async function notifyDoctorOfCompletedIntake(medplum: MedplumClient, patientId: string): Promise<void> {
  const doctorPhone = process.env.DOCTOR_PHONE_NUMBER;
  if (!doctorPhone) {
    log.warn('DOCTOR_PHONE_NUMBER not set, skipping notification call');
    return;
  }

  const patient = await medplum.readResource('Patient', patientId);
  const patientName = `${patient.name?.[0]?.given?.[0] ?? ''} ${patient.name?.[0]?.family ?? ''}`.trim() || 'a patient';

  const [impressions, tasks] = await Promise.all([
    medplum.searchResources('ClinicalImpression', `subject=Patient/${patientId}&_sort=-_lastUpdated&_count=1`),
    medplum.searchResources('Task', `patient=Patient/${patientId}&status=requested`),
  ]);

  const ext = impressions[0]?.extension?.find((e) => e.url === DIFFERENTIAL_ITEMS_EXTENSION_URL);
  let topCondition: DifferentialItem | undefined;
  if (ext?.valueString) {
    try {
      const items = JSON.parse(ext.valueString) as DifferentialItem[];
      topCondition = items[0];
    } catch {
      // ignore parse errors, fall through with no condition
    }
  }

  const urgent = tasks.length > 0;
  const findingText = urgent
    ? tasks.map((t) => t.description).join('. ')
    : topCondition
      ? `${topCondition.condition}, ${topCondition.likelihood} likelihood`
      : 'symptoms recorded during intake';

  const message = urgent
    ? `Hi Doctor, this is calling regarding ${patientName}, who just finished intake with an urgent finding: ${findingText}. Please come see them urgently.`
    : `Hi Doctor, this is calling regarding ${patientName}, who just finished intake. Top consideration: ${findingText}. Please review at their scheduled appointment time.`;

  log.info('notifying doctor', { patientName, urgent, message });
  const result = await placeOutboundNotificationCall(doctorPhone, message);
  log.info('doctor notification call placed', { sid: result.sid });
}
