import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.MEDPLUM_BASE_URL as string;
  const res = await fetch(new URL('oauth2/token', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MEDPLUM_CLIENT_ID as string,
      client_secret: process.env.MEDPLUM_CLIENT_SECRET as string,
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  const data = await res.json();
  return NextResponse.json({ accessToken: data.access_token });
}
