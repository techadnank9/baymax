// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
'use client';
import '@mantine/core/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';

const medplum = new MedplumClient({
  // Use Next.js fetch
  fetch: (url: string, options?: any) => fetch(url, options),

  // Recommend using cache for React performance
  cacheTime: 10000,
});

export default function Root(props: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/auth/token')
      .then((res) => res.json())
      .then((data) => {
        if (data.accessToken) {
          medplum.setAccessToken(data.accessToken);
        }
        setReady(true);
      })
      .catch((err) => {
        console.error('Failed to authenticate with Medplum:', err);
        setReady(true);
      });
  }, []);

  if (!ready) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  return <MedplumProvider medplum={medplum}>{props.children}</MedplumProvider>;
}
