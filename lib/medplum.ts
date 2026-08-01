import { MedplumClient } from '@medplum/core';
import { createLogger } from './logger';

const log = createLogger('lib/medplum');

let client: MedplumClient | undefined;

export function getServerMedplumClient(): MedplumClient {
  if (client) {
    return client;
  }
  client = new MedplumClient({
    baseUrl: process.env.MEDPLUM_BASE_URL,
    fetch: (url: string, options?: any) => fetch(url, options),
  });
  return client;
}

export async function getAuthenticatedMedplumClient(): Promise<MedplumClient> {
  const medplum = getServerMedplumClient();
  if (!medplum.getActiveLogin()) {
    log.info('logging in with client credentials');
    await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID as string, process.env.MEDPLUM_CLIENT_SECRET as string);
    log.info('login ok');
  }
  return medplum;
}
