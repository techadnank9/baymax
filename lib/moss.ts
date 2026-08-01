import type { MossClient as MossClientType } from '@moss-dev/moss';

let client: MossClientType | undefined;

// Dynamic import (not a top-level static import) is deliberate: @moss-dev/moss-core is a native
// N-API addon, and Next's build-time "collect page data" step eagerly evaluates static imports
// of route modules even without invoking the handler -- which loads the native binary during
// build and fails there if the platform-specific binary isn't resolved yet. Deferring the import
// to actual request time avoids that build-time load entirely.
export async function getMossClient(): Promise<MossClientType> {
  if (client) {
    return client;
  }
  const { MossClient } = await import('@moss-dev/moss');
  client = new MossClient(process.env.MOSS_PROJECT_ID as string, process.env.MOSS_API_KEY as string);
  return client;
}

export function historyIndexName(patientId: string): string {
  return `patient-history-${patientId}`;
}
