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

// Speaks `message`, then records the doctor's spoken reply and POSTs it (as SpeechResult) to
// `responseWebhookUrl` once they finish talking (or after a pause). Requires a publicly
// reachable webhook -- Twilio must be able to reach it from the internet.
export async function placeOutboundCallWithResponse(
  to: string,
  message: string,
  responseWebhookUrl: string
): Promise<{ sid: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID as string;
  const from = process.env.TWILIO_PHONE_NUMBER as string;
  const twiml =
    `<Response>` +
    `<Say voice="Polly.Joanna">${escapeXml(message)}</Say>` +
    `<Gather input="speech" action="${escapeXml(responseWebhookUrl)}" method="POST" speechTimeout="auto" timeout="8" actionOnEmptyResult="true">` +
    `<Say voice="Polly.Joanna">Please say your response after the tone.</Say>` +
    `</Gather>` +
    `</Response>`;

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
