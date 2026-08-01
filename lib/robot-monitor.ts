import type { MedplumClient } from '@medplum/core';
import type { Communication, Encounter, Observation, Patient, Task } from '@medplum/fhirtypes';
import { placeOutboundAgentCall } from './twilio';
import { createLogger } from './logger';

const log = createLogger('lib/robot-monitor');

const ROBOT_PATIENT_ID_SYSTEM = 'https://agentic-intake.example/robot-patient-id';

export interface MonitorReadings {
  heartRateBpm?: number;
  spo2Percent?: number;
  alarm?: string;
}

export interface PatientSpeech {
  heard: boolean;
  transcript?: string;
}

export interface RobotIncidentPayload {
  roomId: string;
  patientId: string; // the robot's own id for this patient, not ours
  patientName?: string;
  incidentType: string;
  severity: 'critical' | 'urgent' | 'routine' | string;
  monitorReadings?: MonitorReadings;
  patientSpeech?: PatientSpeech;
  simulationOnly?: boolean;
}

async function findOrCreatePatient(medplum: MedplumClient, payload: RobotIncidentPayload): Promise<Patient> {
  const existing = await medplum.searchResources(
    'Patient',
    `identifier=${encodeURIComponent(`${ROBOT_PATIENT_ID_SYSTEM}|${payload.patientId}`)}`
  );
  if (existing.length > 0) {
    return existing[0];
  }

  const name = payload.patientName?.trim() || `Robot Patient ${payload.patientId}`;
  const parts = name.split(/\s+/);
  const patient = await medplum.createResource<Patient>({
    resourceType: 'Patient',
    name: [{ given: parts.slice(0, -1).length ? parts.slice(0, -1) : [parts[0]], family: parts.length > 1 ? parts[parts.length - 1] : undefined }],
    identifier: [{ system: ROBOT_PATIENT_ID_SYSTEM, value: payload.patientId }],
  });
  log.info('created patient from robot payload', { id: patient.id, name });
  return patient;
}

async function findOrCreateActiveEncounter(medplum: MedplumClient, patientId: string): Promise<Encounter> {
  const existing = await medplum.searchResources(
    'Encounter',
    `subject=Patient/${patientId}&status=in-progress&_sort=-_lastUpdated&_count=1`
  );
  if (existing.length > 0) {
    return existing[0];
  }
  return medplum.createResource<Encounter>({
    resourceType: 'Encounter',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: { reference: `Patient/${patientId}` },
  });
}

export interface RobotIncidentResult {
  patientId: string;
  encounterId: string;
  observationIds: string[];
  taskId?: string;
  doctorCallSid?: string;
}

export async function ingestRobotIncident(medplum: MedplumClient, payload: RobotIncidentPayload): Promise<RobotIncidentResult> {
  const patient = await findOrCreatePatient(medplum, payload);
  const encounter = await findOrCreateActiveEncounter(medplum, patient.id as string);
  const patientName = `${patient.name?.[0]?.given?.[0] ?? ''} ${patient.name?.[0]?.family ?? ''}`.trim() || 'the patient';

  const observationIds: string[] = [];
  const readings = payload.monitorReadings ?? {};

  if (readings.heartRateBpm !== undefined) {
    const obs = await medplum.createResource<Observation>({
      resourceType: 'Observation',
      status: 'final',
      subject: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.id}` },
      code: { coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }], text: 'Heart rate' },
      valueQuantity: { value: readings.heartRateBpm, unit: 'bpm', code: '/min' },
    });
    observationIds.push(obs.id as string);
  }

  if (readings.spo2Percent !== undefined) {
    const obs = await medplum.createResource<Observation>({
      resourceType: 'Observation',
      status: 'final',
      subject: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.id}` },
      code: { coding: [{ system: 'http://loinc.org', code: '59408-5', display: 'Oxygen saturation' }], text: 'Oxygen saturation (SpO2)' },
      valueQuantity: { value: readings.spo2Percent, unit: '%', code: '%' },
    });
    observationIds.push(obs.id as string);
  }

  if (payload.patientSpeech?.heard && payload.patientSpeech.transcript) {
    const obs = await medplum.createResource<Observation>({
      resourceType: 'Observation',
      status: 'final',
      subject: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.id}` },
      code: { text: 'Patient-reported symptom (via room monitor)' },
      valueString: payload.patientSpeech.transcript,
    });
    observationIds.push(obs.id as string);
  }

  let taskId: string | undefined;
  let doctorCallSid: string | undefined;
  const isCritical = payload.severity === 'critical' || readings.alarm === 'critical';

  if (isCritical) {
    const finding = [
      `${payload.incidentType} in room ${payload.roomId}`,
      readings.heartRateBpm !== undefined ? `HR ${readings.heartRateBpm} bpm` : '',
      readings.spo2Percent !== undefined ? `SpO2 ${readings.spo2Percent}%` : '',
      payload.patientSpeech?.transcript ? `Patient said: "${payload.patientSpeech.transcript}"` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'proposal',
      for: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.id}` },
      description: `${finding} -- Immediate clinical evaluation recommended.`,
    });
    taskId = task.id;
    log.info('critical incident flagged', { taskId, finding });

    const doctorPhone = process.env.DOCTOR_PHONE_NUMBER;
    const phoneBridgeWssUrl = process.env.PHONE_BRIDGE_WSS_URL;
    if (doctorPhone && phoneBridgeWssUrl) {
      const communication = await medplum.createResource<Communication>({
        resourceType: 'Communication',
        status: 'in-progress',
        subject: { reference: `Patient/${patient.id}` },
        sent: new Date().toISOString(),
        payload: [{ contentString: `Critical alert from room monitor: ${finding}` }],
        note: [{ text: '[call in progress]' }],
      });
      const streamUrl = `${phoneBridgeWssUrl}/stream?mode=doctor&patientId=${patient.id}&communicationId=${communication.id}`;
      try {
        const result = await placeOutboundAgentCall(doctorPhone, streamUrl);
        doctorCallSid = result.sid;
        await medplum.updateResource<Communication>({
          ...communication,
          identifier: [{ system: 'https://api.twilio.com/callSid', value: result.sid }],
        });
        log.info('critical alert call placed', { sid: result.sid, communicationId: communication.id });
      } catch (err) {
        log.error('critical alert call failed', err);
      }
    } else {
      log.warn('DOCTOR_PHONE_NUMBER or PHONE_BRIDGE_WSS_URL not set, skipping critical alert call');
    }
  }

  return {
    patientId: patient.id as string,
    encounterId: encounter.id as string,
    observationIds,
    taskId,
    doctorCallSid,
  };
}
