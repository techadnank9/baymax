// Places a one-way outbound call that reads back a clinician-approved message via Twilio's
// built-in TTS (<Say>). Deliberately NOT connected to the Deepgram voice agent -- this only ever
// speaks text a clinician has already approved (via the Task Approve action), never unreviewed
// LLM output, so there's no path for an unverified differential to be spoken to a patient.
export async function placeOutboundNotificationCall(to: string, message: string): Promise<{ sid: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const auth = process.env.TWILIO_AUTH_TOKEN as string;
  const from = process.env.TWILIO_PHONE_NUMBER as string;

  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const twiml = `<Response><Say voice="Polly.Joanna">${escaped}</Say></Response>`;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }),
  });

  if (!res.ok) {
    throw new Error(`Twilio call failed: HTTP ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return { sid: data.sid };
}
