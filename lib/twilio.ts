// Places outbound calls via Twilio's REST API using inline TwiML (no hosted TwiML endpoint
// needed for the simple one-way case). All spoken text passed in here must already be
// clinician-approved or system-generated from charted data -- never raw unreviewed LLM output.

function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const auth = process.env.TWILIO_AUTH_TOKEN as string;
  return `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function placeOutboundNotificationCall(to: string, message: string): Promise<{ sid: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const from = process.env.TWILIO_PHONE_NUMBER as string;
  const twiml = `<Response><Say voice="Polly.Joanna">${escapeXml(message)}</Say></Response>`;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }),
  });
  if (!res.ok) {
    throw new Error(`Twilio call failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { sid: data.sid };
}

// Places a call and connects its audio to the phone-bridge's Media Stream (same mechanism as an
// inbound patient call, just Twilio-initiated instead of Twilio-received) -- the phone-bridge then
// opens a real Deepgram Voice Agent session so the doctor has an actual back-and-forth
// conversation, not a scripted Say/Gather.
export async function placeOutboundAgentCall(to: string, streamUrl: string): Promise<{ sid: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const from = process.env.TWILIO_PHONE_NUMBER as string;
  const twiml = `<Response><Connect><Stream url="${escapeXml(streamUrl)}" /></Connect></Response>`;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: twilioAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }),
  });
  if (!res.ok) {
    throw new Error(`Twilio call failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { sid: data.sid };
}
