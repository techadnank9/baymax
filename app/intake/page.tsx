'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';

const clientLog = createLogger('intake');

type Status = 'idle' | 'connecting' | 'live' | 'error';
type OrbState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SPEAKING_COOLDOWN_MS = 500;

export default function IntakePage(): JSX.Element {
  const [status, setStatus] = useState<Status>('idle');
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [patientFirstName, setPatientFirstName] = useState<string | null>(null);
  const [identifiedPatientId, setIdentifiedPatientId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackTimeRef = useRef(0);
  const patientIdRef = useRef<string | null>(null);
  const encounterIdRef = useRef<string | null>(null);
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function log(line: string): void {
    setTranscript((t) => [...t, line]);
    clientLog.info(line);
  }

  function addMessage(role: 'user' | 'assistant', content: string): void {
    setMessages((m) => [...m, { role, content }]);
  }

  function onPatientIdentified(id: string, firstName: string): void {
    patientIdRef.current = id;
    setPatientFirstName(firstName);
    setIdentifiedPatientId(id);
  }

  function markSpeaking(): void {
    setOrbState('speaking');
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
    }
    speakingTimeoutRef.current = setTimeout(() => setOrbState('listening'), SPEAKING_COOLDOWN_MS);
  }

  async function start(): Promise<void> {
    setStatus('connecting');
    setOrbState('connecting');
    clientLog.info('start() called');
    try {
      const res = await fetch('/api/agent-config');
      const { wsUrl, apiKey, settings } = await res.json();

      const audioCtx = new AudioContext({ sampleRate: settings.audio.input.sample_rate });
      audioCtxRef.current = audioCtx;
      playbackTimeRef.current = audioCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ws = new WebSocket(wsUrl, ['token', apiKey]);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify(settings));
        setStatus('live');
        setOrbState('listening');
        log('Connected. Say hello.');

        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) {
            return;
          }
          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(pcm16.buffer);
        };
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'FunctionCallRequest') {
              setOrbState('thinking');
              handleFunctionCallRequest(msg, ws, patientIdRef, encounterIdRef, log, onPatientIdentified);
            } else {
              if (msg.type === 'AgentThinking') {
                setOrbState('thinking');
              }
              handleAgentMessage(msg, log, addMessage);
            }
          } catch {
            // non-JSON text, ignore
          }
          return;
        }
        // Binary = agent speech audio (linear16 PCM at settings.audio.output.sample_rate)
        markSpeaking();
        playAudioChunk(event.data as ArrayBuffer, audioCtx, playbackTimeRef, settings.audio.output.sample_rate);
      };

      ws.onerror = (event) => {
        setStatus('error');
        setOrbState('idle');
        clientLog.error('WebSocket error', event);
        log('WebSocket error.');
      };

      ws.onclose = (event) => {
        setStatus('idle');
        setOrbState('idle');
        clientLog.warn('WebSocket closed', { code: event.code, reason: event.reason });
        log('Disconnected.');
      };
    } catch (err) {
      clientLog.error('start() failed', err);
      setStatus('error');
      setOrbState('idle');
      log(`Failed to start: ${(err as Error).message}`);
    }
  }

  function stop(): void {
    clientLog.info('stop() called');
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
    }
    if (encounterIdRef.current) {
      fetch('/api/intake/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId: encounterIdRef.current }),
      }).catch((err) => clientLog.error('failed to end encounter', err));
    }
    setStatus('idle');
    setOrbState('idle');
  }

  function startOver(): void {
    stop();
    patientIdRef.current = null;
    encounterIdRef.current = null;
    setPatientFirstName(null);
    setIdentifiedPatientId(null);
    setMessages([]);
    setTranscript([]);
  }

  const isLive = status === 'live' || status === 'connecting';
  const stateLabel: Record<OrbState, string> = {
    idle: 'Tap to begin',
    connecting: 'Connecting…',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  };

  return (
    <div className="page">
      <header className="header">
        <span className="clinicName">Agentic Intake</span>
        <Link
          href={identifiedPatientId ? `/clinician?patientId=${identifiedPatientId}` : '/clinician'}
          className="dashboardLink"
        >
          View clinician dashboard →
        </Link>
      </header>

      <main className="main">
        {patientFirstName && (
          <div className="patientBanner">
            Checked in as <strong>{patientFirstName}</strong>.{' '}
            <button type="button" className="notYouLink" onClick={startOver} disabled={isLive}>
              Not you? Start over
            </button>
          </div>
        )}

        <button
          type="button"
          className={`orb orb-${orbState}`}
          onClick={isLive ? stop : start}
          aria-label={isLive ? 'End conversation' : 'Start conversation'}
        >
          <span className="orb-core" />
        </button>

        <p className="stateLabel">{stateLabel[orbState]}</p>
        {!isLive && !patientFirstName && (
          <p className="hint">This is a shared device — the assistant will ask for your name by voice.</p>
        )}

        <button type="button" className="primaryButton" onClick={isLive ? stop : start}>
          {isLive ? 'End conversation' : 'Start conversation'}
        </button>

        {messages.length > 0 && (
          <div className="chat" role="log" aria-label="Conversation">
            {messages.map((m, i) => (
              <div key={i} className={`bubbleRow bubbleRow-${m.role}`}>
                <div className={`bubble bubble-${m.role}`}>{m.content}</div>
              </div>
            ))}
          </div>
        )}

        {!isLive && messages.length > 0 && identifiedPatientId && (
          <Link href={`/clinician?patientId=${identifiedPatientId}`} className="finishedLink">
            Conversation ended — view the clinician dashboard →
          </Link>
        )}

        <button type="button" className="logToggle" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide debug log' : 'Show debug log'}
        </button>

        {showLog && (
          <div className="log" role="log">
            {transcript.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </main>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:wght@500;600&family=Raleway:wght@400;500&display=swap');

        .page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #ecfeff;
          font-family: 'Raleway', sans-serif;
          color: #164e63;
        }

        .header {
          padding: 24px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .clinicName {
          font-family: 'Lora', serif;
          font-weight: 600;
          font-size: 1.125rem;
          color: #0891b2;
        }

        .dashboardLink {
          color: #059669;
          font-size: 0.875rem;
          font-weight: 500;
          text-decoration: none;
          cursor: pointer;
          padding: 8px 4px;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
        }

        .dashboardLink:hover {
          text-decoration: underline;
        }

        .main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 24px;
          padding: 24px;
        }

        .hint {
          max-width: 320px;
          text-align: center;
          color: #475569;
          font-size: 0.875rem;
          margin-top: -12px;
        }

        .patientBanner {
          font-size: 0.875rem;
          color: #475569;
        }

        .notYouLink {
          background: none;
          border: none;
          color: #0891b2;
          text-decoration: underline;
          cursor: pointer;
          font-size: 0.875rem;
          padding: 4px;
        }

        .notYouLink:disabled {
          color: #94a3b8;
          cursor: not-allowed;
          text-decoration: none;
        }

        .orb {
          position: relative;
          width: 180px;
          height: 180px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          background: radial-gradient(circle at 35% 30%, #67e8f9, #0891b2 70%);
          box-shadow: 0 0 0 0 rgba(8, 145, 178, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          transition:
            transform 250ms ease-out,
            box-shadow 250ms ease-out;
        }

        .orb:focus-visible {
          outline: 3px solid #059669;
          outline-offset: 4px;
        }

        .orb-core {
          width: 60%;
          height: 60%;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 35%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 70%);
        }

        .orb-idle {
          animation: breathe 4s ease-in-out infinite;
        }

        .orb-connecting {
          animation: spinPulse 1.2s linear infinite;
        }

        .orb-listening {
          animation: listenPulse 2.2s ease-in-out infinite;
        }

        .orb-thinking {
          animation: thinkPulse 1.4s ease-in-out infinite;
        }

        .orb-speaking {
          animation: speakPulse 0.9s ease-in-out infinite;
        }

        @keyframes breathe {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.03);
          }
        }

        @keyframes listenPulse {
          0%,
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(8, 145, 178, 0.3);
          }
          50% {
            transform: scale(1.05);
            box-shadow: 0 0 0 16px rgba(8, 145, 178, 0);
          }
        }

        @keyframes thinkPulse {
          0%,
          100% {
            transform: scale(0.98) rotate(0deg);
          }
          50% {
            transform: scale(1.02) rotate(4deg);
          }
        }

        @keyframes speakPulse {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.08);
          }
        }

        @keyframes spinPulse {
          0% {
            transform: scale(0.95) rotate(0deg);
          }
          50% {
            transform: scale(1.02) rotate(180deg);
          }
          100% {
            transform: scale(0.95) rotate(360deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .orb-idle,
          .orb-connecting,
          .orb-listening,
          .orb-thinking,
          .orb-speaking {
            animation: none;
          }
        }

        .stateLabel {
          font-size: 1rem;
          color: #475569;
          min-height: 1.5em;
        }

        .primaryButton {
          padding: 12px 28px;
          border-radius: 999px;
          border: none;
          background: #059669;
          color: white;
          font-family: 'Raleway', sans-serif;
          font-weight: 500;
          font-size: 1rem;
          cursor: pointer;
          transition:
            background-color 200ms ease,
            transform 150ms ease;
          min-height: 44px;
        }

        .primaryButton:hover {
          background-color: #047857;
        }

        .primaryButton:focus-visible {
          outline: 3px solid #0891b2;
          outline-offset: 2px;
        }

        .chat {
          width: 100%;
          max-width: 640px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 320px;
          overflow-y: auto;
          padding: 4px;
        }

        .bubbleRow {
          display: flex;
        }

        .bubbleRow-user {
          justify-content: flex-end;
        }

        .bubbleRow-assistant {
          justify-content: flex-start;
        }

        .bubble {
          max-width: 80%;
          padding: 10px 16px;
          border-radius: 16px;
          font-size: 0.9375rem;
          line-height: 1.5;
        }

        .bubble-assistant {
          background: white;
          border: 1px solid #a5f3fc;
          color: #164e63;
          border-bottom-left-radius: 4px;
        }

        .bubble-user {
          background: #0891b2;
          color: white;
          border-bottom-right-radius: 4px;
        }

        .finishedLink {
          color: #059669;
          font-weight: 500;
          text-decoration: none;
          padding: 8px;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
        }

        .finishedLink:hover {
          text-decoration: underline;
        }

        .logToggle {
          background: none;
          border: none;
          color: #0891b2;
          font-size: 0.875rem;
          cursor: pointer;
          text-decoration: underline;
          padding: 8px;
          min-height: 44px;
        }

        .log {
          width: 100%;
          max-width: 640px;
          max-height: 260px;
          overflow-y: auto;
          background: white;
          border: 1px solid #a5f3fc;
          border-radius: 8px;
          padding: 16px;
          font-family: ui-monospace, monospace;
          font-size: 0.8125rem;
          line-height: 1.6;
          color: #164e63;
        }
      `}</style>
    </div>
  );
}

const TOOL_ROUTES: Record<string, string> = {
  chartObservation: '/api/tools/chart-observation',
  lookupHistory: '/api/tools/lookup-history',
  runDifferential: '/api/tools/run-differential',
  checkEligibility: '/api/tools/check-eligibility',
  flagRedFlag: '/api/tools/flag-red-flag',
};

function handleFunctionCallRequest(
  msg: any,
  ws: WebSocket,
  patientIdRef: { current: string | null },
  encounterIdRef: { current: string | null },
  log: (line: string) => void,
  onPatientIdentified: (id: string, firstName: string) => void
): void {
  for (const fn of msg.functions ?? []) {
    const args = JSON.parse(fn.arguments || '{}');
    log(`[tool] ${fn.name}(${fn.arguments})`);

    if (fn.name === 'identifyPatient') {
      fetch('/api/tools/identify-patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.name }),
      })
        .then((res) => res.json())
        .then(async (result) => {
          log(`[tool result] ${JSON.stringify(result)}`);
          if (result.status === 'confirmed') {
            patientIdRef.current = result.id;
            const startRes = await fetch('/api/intake/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ patientId: result.id }),
            });
            const { encounterId } = await startRes.json();
            encounterIdRef.current = encounterId;
            log(`[system] Encounter started: ${encounterId}`);
            onPatientIdentified(result.id, result.firstName);
          }
          ws.send(
            JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content: JSON.stringify(result) })
          );
        })
        .catch((err) => {
          log(`[tool error] ${err.message}`);
          ws.send(
            JSON.stringify({
              type: 'FunctionCallResponse',
              id: fn.id,
              name: fn.name,
              content: JSON.stringify({ error: err.message }),
            })
          );
        });
      continue;
    }

    const route = TOOL_ROUTES[fn.name];
    if (!route) {
      continue;
    }
    if (!patientIdRef.current || !encounterIdRef.current) {
      log(`[tool] ${fn.name} called before identification, rejecting`);
      ws.send(
        JSON.stringify({
          type: 'FunctionCallResponse',
          id: fn.id,
          name: fn.name,
          content: JSON.stringify({ error: 'Patient not identified yet -- call identifyPatient first.' }),
        })
      );
      continue;
    }
    fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, patientId: patientIdRef.current, encounterId: encounterIdRef.current }),
    })
      .then((res) => res.json())
      .then((result) => {
        log(`[tool result] ${JSON.stringify(result)}`);
        ws.send(
          JSON.stringify({
            type: 'FunctionCallResponse',
            id: fn.id,
            name: fn.name,
            content: JSON.stringify(result),
          })
        );
      })
      .catch((err) => {
        log(`[tool error] ${err.message}`);
        ws.send(
          JSON.stringify({
            type: 'FunctionCallResponse',
            id: fn.id,
            name: fn.name,
            content: JSON.stringify({ error: err.message }),
          })
        );
      });
  }
}

function handleAgentMessage(
  msg: any,
  log: (line: string) => void,
  addMessage: (role: 'user' | 'assistant', content: string) => void
): void {
  switch (msg.type) {
    case 'Welcome':
      log('[agent] connection established');
      break;
    case 'SettingsApplied':
      log('[agent] settings applied');
      break;
    case 'ConversationText':
      log(`[${msg.role}] ${msg.content}`);
      if (msg.role === 'user' || msg.role === 'assistant') {
        addMessage(msg.role, msg.content);
      }
      break;
    case 'AgentThinking':
      break;
    case 'Error':
      log(`[error] ${msg.description ?? JSON.stringify(msg)}`);
      break;
    default:
      break;
  }
}

function playAudioChunk(
  chunk: ArrayBuffer,
  audioCtx: AudioContext,
  playbackTimeRef: { current: number },
  sampleRate: number
): void {
  const pcm16 = new Int16Array(chunk);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 0x8000;
  }
  const buffer = audioCtx.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  const startAt = Math.max(now, playbackTimeRef.current);
  source.start(startAt);
  playbackTimeRef.current = startAt + buffer.duration;
}
