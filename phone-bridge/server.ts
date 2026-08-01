import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY as string;
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8080);
const AGENT_CONFIG_URL = process.env.AGENT_CONFIG_URL as string; // e.g. https://your-app.vercel.app/api/agent-config
const APP_BASE_URL = new URL(AGENT_CONFIG_URL).origin;
const DEEPGRAM_WS_URL = 'wss://agent.deepgram.com/v1/agent/converse';

function log(scope: string, message: string, data?: unknown): void {
  const line = `[${new Date().toISOString()}] [phone-bridge:${scope}] ${message}`;
  if (data !== undefined) {
    console.log(line, data);
  } else {
    console.log(line);
  }
}

const TOOL_ROUTES: Record<string, string> = {
  chartObservation: '/api/tools/chart-observation',
  lookupHistory: '/api/tools/lookup-history',
  runDifferential: '/api/tools/run-differential',
  checkEligibility: '/api/tools/check-eligibility',
  flagRedFlag: '/api/tools/flag-red-flag',
};

async function fetchAgentSettings(): Promise<any> {
  const res = await fetch(`${APP_BASE_URL}/api/agent-config?encoding=mulaw`);
  const data = await res.json();
  return data.settings;
}

async function startEncounter(patientId: string): Promise<string> {
  const res = await fetch(`${APP_BASE_URL}/api/intake/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientId }),
  });
  const data = await res.json();
  return data.encounterId;
}

interface CallState {
  patientId: string | null;
  encounterId: string | null;
  ended: boolean;
}

function endEncounter(state: CallState): void {
  if (state.ended || !state.encounterId) {
    return;
  }
  state.ended = true;
  fetch(`${APP_BASE_URL}/api/intake/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encounterId: state.encounterId }),
  })
    .then(() => log('encounter', 'ended', { encounterId: state.encounterId }))
    .catch((err) => log('encounter', 'failed to end', err));
}

async function handleFunctionCallRequest(msg: any, dgWs: WebSocket, state: CallState): Promise<void> {
  for (const fn of msg.functions ?? []) {
    const args = JSON.parse(fn.arguments || '{}');
    log('tool', `${fn.name}(${fn.arguments})`);

    if (fn.name === 'identifyPatient') {
      try {
        const res = await fetch(`${APP_BASE_URL}/api/tools/identify-patient`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: args.name }),
        });
        const result = await res.json();
        if (result.status === 'confirmed') {
          state.patientId = result.id;
          state.encounterId = await startEncounter(result.id);
          log('encounter', 'started after identification', { patientId: state.patientId, encounterId: state.encounterId });
        }
        log('tool result', JSON.stringify(result));
        dgWs.send(
          JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content: JSON.stringify(result) })
        );
      } catch (err) {
        log('tool error', (err as Error).message);
        dgWs.send(
          JSON.stringify({
            type: 'FunctionCallResponse',
            id: fn.id,
            name: fn.name,
            content: JSON.stringify({ error: (err as Error).message }),
          })
        );
      }
      continue;
    }

    const route = TOOL_ROUTES[fn.name];
    if (!route) {
      log('tool', `no route for ${fn.name}, skipping`);
      continue;
    }
    if (!state.patientId || !state.encounterId) {
      log('tool', `${fn.name} called before identification, rejecting`);
      dgWs.send(
        JSON.stringify({
          type: 'FunctionCallResponse',
          id: fn.id,
          name: fn.name,
          content: JSON.stringify({ error: 'Patient not identified yet -- call identifyPatient first.' }),
        })
      );
      continue;
    }
    try {
      const res = await fetch(`${APP_BASE_URL}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...args, patientId: state.patientId, encounterId: state.encounterId }),
      });
      const result = await res.json();
      log('tool result', JSON.stringify(result));
      dgWs.send(JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content: JSON.stringify(result) }));
    } catch (err) {
      log('tool error', (err as Error).message);
      dgWs.send(
        JSON.stringify({
          type: 'FunctionCallResponse',
          id: fn.id,
          name: fn.name,
          content: JSON.stringify({ error: (err as Error).message }),
        })
      );
    }
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.url === '/twiml') {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    const wsUrl = `wss://${req.headers.host}/stream`;
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${wsUrl}" /></Connect></Response>`
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/stream' });

wss.on('connection', (twilioWs) => {
  log('twilio', 'connection opened');
  let streamSid: string | null = null;
  let dgWs: WebSocket | null = null;
  const state: CallState = { patientId: null, encounterId: null, ended: false };

  twilioWs.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      log('twilio', 'non-JSON message, ignoring');
      return;
    }

    if (msg.event === 'connected') {
      log('twilio', 'connected event');
      return;
    }

    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      log('twilio', 'stream started', { streamSid, callSid: msg.start.callSid });

      try {
        const settings = await fetchAgentSettings();
        dgWs = new WebSocket(DEEPGRAM_WS_URL, ['token', DEEPGRAM_API_KEY]);

        dgWs.on('open', () => {
          log('deepgram', 'connection open, sending settings');
          dgWs!.send(JSON.stringify(settings));
        });

        dgWs.on('message', (dgRaw, isBinary) => {
          if (!isBinary) {
            let dgMsg: any;
            try {
              dgMsg = JSON.parse(dgRaw.toString());
            } catch {
              return;
            }
            if (dgMsg.type === 'FunctionCallRequest') {
              handleFunctionCallRequest(dgMsg, dgWs as WebSocket, state).catch((err) =>
                log('tool', 'handler crashed', err)
              );
            } else if (dgMsg.type === 'UserStartedSpeaking') {
              // Barge-in: tell Twilio to drop any buffered playback immediately.
              // NOTE: "UserStartedSpeaking" is the commonly-documented Deepgram Voice Agent
              // barge-in event name but wasn't confirmed against current live docs during
              // this build -- verify the exact type string against a real session and adjust
              // if Deepgram logs a different one.
              if (streamSid) {
                twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
              }
            } else if (dgMsg.type === 'ConversationText') {
              log('transcript', `[${dgMsg.role}] ${dgMsg.content}`);
            } else if (dgMsg.type === 'Error') {
              log('deepgram', 'error message', dgMsg);
            }
            return;
          }
          // Binary = agent speech audio (mulaw/8000, matches Twilio's expected format directly).
          if (streamSid) {
            twilioWs.send(
              JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: Buffer.from(dgRaw as Buffer).toString('base64') },
              })
            );
          }
        });

        dgWs.on('error', (err) => log('deepgram', 'websocket error', err));
        dgWs.on('close', (code, reason) => log('deepgram', 'websocket closed', { code, reason: reason.toString() }));
      } catch (err) {
        log('deepgram', 'failed to start session', err);
      }
      return;
    }

    if (msg.event === 'media') {
      if (dgWs && dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(Buffer.from(msg.media.payload, 'base64'));
      }
      return;
    }

    if (msg.event === 'stop') {
      log('twilio', 'stream stopped');
      dgWs?.close();
      endEncounter(state);
      return;
    }
  });

  twilioWs.on('close', () => {
    log('twilio', 'connection closed');
    dgWs?.close();
    endEncounter(state);
  });

  twilioWs.on('error', (err) => log('twilio', 'websocket error', err));
});

httpServer.listen(BRIDGE_PORT, () => {
  log('server', `listening on port ${BRIDGE_PORT}`);
});
