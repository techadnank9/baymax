import { MossClient } from '@moss-dev/moss';

let client: MossClient | undefined;

export function getMossClient(): MossClient {
  if (client) {
    return client;
  }
  client = new MossClient(process.env.MOSS_PROJECT_ID as string, process.env.MOSS_API_KEY as string);
  return client;
}

export function historyIndexName(patientId: string): string {
  return `patient-history-${patientId}`;
}
