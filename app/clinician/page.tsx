'use client';

import { PatientHeader, useMedplum } from '@medplum/react';
import type {
  AllergyIntolerance,
  ClinicalImpression,
  Condition,
  Coverage,
  Encounter,
  Observation,
  Patient,
  Task,
} from '@medplum/fhirtypes';
import type { WithId } from '@medplum/core';
import type { JSX } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { DIFFERENTIAL_ITEMS_EXTENSION_URL, type DifferentialItem } from '@/lib/fhir-writes';

const log = createLogger('clinician');

const LIKELIHOOD_SCORE: Record<string, number> = { high: 100, medium: 60, low: 30 };
// Single hue, light -> dark by magnitude (brand cyan), per dataviz sequential-scale convention.
const LIKELIHOOD_COLOR: Record<string, string> = { high: '#0891b2', medium: '#67e8f9', low: '#cffafe' };

function extractDifferentialItems(imp: ClinicalImpression | undefined): DifferentialItem[] {
  if (!imp) {
    return [];
  }
  const ext = imp.extension?.find((e) => e.url === DIFFERENTIAL_ITEMS_EXTENSION_URL);
  if (!ext?.valueString) {
    return [];
  }
  try {
    return JSON.parse(ext.valueString) as DifferentialItem[];
  } catch {
    return [];
  }
}

// Hosted app.medplum.com gates `websocket-subscriptions` behind a support request
// (see https://www.medplum.com/docs/react/use-subscription) -- not self-service via the
// project admin UI. Polling stands in for useSubscription until that flag is granted.
const POLL_INTERVAL_MS = 3000;

export default function ClinicianPageWrapper(): JSX.Element {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <ClinicianPage />
    </Suspense>
  );
}

function ClinicianPage(): JSX.Element {
  const searchParams = useSearchParams();
  const patientId = searchParams.get('patientId');

  if (!patientId) {
    return <PatientQueue />;
  }

  return <PatientChart patientId={patientId} />;
}

interface QueueRow {
  encounter: WithId<Encounter>;
  patient: Patient;
}

function PatientQueue(): JSX.Element {
  const medplum = useMedplum();
  const [queue, setQueue] = useState<QueueRow[] | null>(null);

  const refresh = useCallback(() => {
    medplum
      .searchResources('Encounter', 'status=in-progress&_sort=-_lastUpdated&_count=20')
      .then(async (encounters) => {
        const rows = await Promise.all(
          encounters.map(async (encounter) => {
            const patientRef = encounter.subject?.reference;
            if (!patientRef) {
              return null;
            }
            const patient = await medplum.readReference({ reference: patientRef } as any).catch(() => null);
            return patient ? { encounter, patient: patient as Patient } : null;
          })
        );
        setQueue(rows.filter((r): r is QueueRow => r !== null));
      })
      .catch((e) => log.error('queue search failed', e));
  }, [medplum]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>Patient Queue</h1>
      <p style={{ color: '#888' }}>
        No patient selected. Only patients who have completed voice identification appear here.
      </p>
      {queue === null ? (
        <p>Loading…</p>
      ) : queue.length === 0 ? (
        <p style={{ color: '#888' }}>No active encounters right now.</p>
      ) : (
        <ul>
          {queue.map(({ encounter, patient }) => (
            <li key={encounter.id} style={{ marginBottom: 8 }}>
              <Link href={`/clinician?patientId=${patient.id}`}>
                {patient.name?.[0]?.given?.[0]} {patient.name?.[0]?.family} — encounter started{' '}
                {encounter.period?.start ? new Date(encounter.period.start).toLocaleTimeString() : ''}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PatientChart({ patientId }: { patientId: string }): JSX.Element {
  const medplum = useMedplum();
  const [patient, setPatient] = useState<Patient | undefined>();
  const [notFound, setNotFound] = useState(false);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [allergies, setAllergies] = useState<AllergyIntolerance[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [impressions, setImpressions] = useState<ClinicalImpression[]>([]);
  const [coverages, setCoverages] = useState<Coverage[]>([]);

  const refreshAll = useCallback(() => {
    medplum
      .readResource('Patient', patientId)
      .then(setPatient)
      .catch((e) => {
        log.error('readResource Patient failed', e);
        setNotFound(true);
      });
    medplum
      .searchResources('Condition', `subject=Patient/${patientId}`)
      .then((r) => setConditions([...r]))
      .catch((e) => log.error('search Condition failed', e));
    medplum
      .searchResources('Observation', `subject=Patient/${patientId}`)
      .then((r) => setObservations([...r]))
      .catch((e) => log.error('search Observation failed', e));
    medplum
      .searchResources('AllergyIntolerance', `patient=Patient/${patientId}`)
      .then((r) => setAllergies([...r]))
      .catch((e) => log.error('search AllergyIntolerance failed', e));
    medplum
      .searchResources('Task', `patient=Patient/${patientId}`)
      .then((r) => setTasks([...r]))
      .catch((e) => log.error('search Task failed', e));
    medplum
      .searchResources('ClinicalImpression', `subject=Patient/${patientId}&_sort=-_lastUpdated`)
      .then((r) => setImpressions([...r]))
      .catch((e) => log.error('search ClinicalImpression failed', e));
    medplum
      .searchResources('Coverage', `beneficiary=Patient/${patientId}`)
      .then((r) => setCoverages([...r]))
      .catch((e) => log.error('search Coverage failed', e));
  }, [medplum, patientId]);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshAll]);

  async function approveTask(taskId: string): Promise<void> {
    log.info('approving task', { taskId });
    try {
      const res = await fetch('/api/tasks/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const result = await res.json();
      log.info('approve result', result);
      refreshAll();
    } catch (err) {
      log.error('approve failed', err);
    }
  }

  if (notFound) {
    return (
      <div style={{ padding: 24 }}>
        <p>No patient found for that id.</p>
        <Link href="/clinician">← Back to queue</Link>
      </div>
    );
  }

  if (!patient) {
    return <div style={{ padding: 24 }}>Loading patient…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Link href="/clinician" style={{ fontSize: 14 }}>
        ← Back to queue
      </Link>
      <div style={{ marginTop: 12 }}>
        <PatientHeader patient={patient} />
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>Problem List</h2>
        {conditions?.length ? (
          <ul>
            {conditions.map((c: Condition) => (
              <li key={c.id}>{c.code?.text ?? c.code?.coding?.[0]?.display}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#888' }}>No conditions yet.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Observations</h2>
        {observations?.length ? (
          <ul>
            {observations.map((o: Observation) => (
              <li key={o.id}>
                {o.code?.text ?? o.code?.coding?.[0]?.display}: {o.valueQuantity?.value ?? o.valueString}
                {o.valueQuantity?.unit}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#888' }}>No observations yet.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Allergies</h2>
        {allergies?.length ? (
          <ul>
            {allergies.map((a: AllergyIntolerance) => (
              <li key={a.id}>{a.code?.text ?? a.code?.coding?.[0]?.display}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#888' }}>No known allergies charted.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Problems Overview</h2>
        <ProblemsChart items={extractDifferentialItems(impressions[0])} fallbackSummary={impressions[0]?.summary} />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Suggested Treatment / Next Steps</h2>
        <TreatmentPanel items={extractDifferentialItems(impressions[0])} />
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Red Flags / Pending Orders</h2>
        {tasks?.length ? (
          <ul>
            {tasks.map((t: Task) => (
              <li key={t.id} style={{ marginBottom: 8 }}>
                {t.description} — <strong>{t.status}</strong>
                {t.status === 'requested' && (
                  <button style={{ marginLeft: 12 }} onClick={() => approveTask(t.id as string)}>
                    Approve
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#888' }}>No pending tasks.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Verified Cost</h2>
        {coverages?.length ? (
          <ul>
            {coverages.map((c: Coverage) => (
              <li key={c.id}>
                {c.payor?.[0]?.display} — {c.status} — {c.class?.[0]?.name}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#888' }}>No coverage verified yet.</p>
        )}
      </section>
    </div>
  );
}

function ProblemsChart({ items, fallbackSummary }: { items: DifferentialItem[]; fallbackSummary?: string }): JSX.Element {
  if (items.length === 0) {
    if (fallbackSummary) {
      // Older ClinicalImpression written before the structured extension existed.
      return <pre style={{ whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 12, borderRadius: 6 }}>{fallbackSummary}</pre>;
    }
    return <p style={{ color: '#888' }}>No differential yet.</p>;
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left', fontSize: 13, color: '#888', marginBottom: 8 }}>
          Differential, ranked by likelihood
        </caption>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', fontSize: 13, color: '#888', paddingBottom: 6 }}>Condition</th>
            <th style={{ textAlign: 'left', fontSize: 13, color: '#888', paddingBottom: 6 }}>Likelihood</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const score = LIKELIHOOD_SCORE[item.likelihood] ?? 30;
            const color = LIKELIHOOD_COLOR[item.likelihood] ?? '#cffafe';
            return (
              <tr key={i}>
                <td style={{ padding: '6px 12px 6px 0', fontSize: 14, whiteSpace: 'nowrap' }}>{item.condition}</td>
                <td style={{ padding: '6px 0', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: `${score}%`,
                        maxWidth: 240,
                        height: 14,
                        borderRadius: 4,
                        background: color,
                      }}
                    />
                    <span style={{ fontSize: 12, color: '#475569', textTransform: 'capitalize' }}>{item.likelihood}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TreatmentPanel({ items }: { items: DifferentialItem[] }): JSX.Element {
  if (items.length === 0) {
    return <p style={{ color: '#888' }}>No suggestions yet -- run the differential first.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item, i) => (
        <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 14 }}>{item.condition}</strong>
            <span style={{ fontSize: 12, color: '#475569', textTransform: 'capitalize' }}>{item.likelihood} likelihood</span>
          </div>
          {item.suggestedNextSteps && (
            <p style={{ fontSize: 13, color: '#164e63', marginTop: 4 }}>{item.suggestedNextSteps}</p>
          )}
          {item.citations?.length > 0 && (
            <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Refs: {item.citations.join(', ')}</p>
          )}
        </div>
      ))}
    </div>
  );
}
