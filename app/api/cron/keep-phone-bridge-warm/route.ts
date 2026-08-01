import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/cron/keep-phone-bridge-warm');

// Render's free tier spins the phone-bridge down after a period of inactivity; the next request
// (a real Twilio call) then has to wait for a cold start, which can be slower than Twilio's Media
// Stream connection timeout -- resulting in a call that connects on the PSTN side but never
// actually reaches our WebSocket, silently failing. Pinging /health on a schedule keeps it warm.
export async function GET(): Promise<NextResponse> {
  const phoneBridgeWssUrl = process.env.PHONE_BRIDGE_WSS_URL;
  if (!phoneBridgeWssUrl) {
    log.warn('PHONE_BRIDGE_WSS_URL not set, nothing to ping');
    return NextResponse.json({ ok: false, reason: 'not configured' });
  }
  const healthUrl = phoneBridgeWssUrl.replace(/^wss:/, 'https:') + '/health';
  try {
    const res = await fetch(healthUrl, { cache: 'no-store' });
    log.info('pinged phone-bridge', { status: res.status });
    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err) {
    log.error('ping failed', err);
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
