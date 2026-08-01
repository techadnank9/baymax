export const SYSTEM_PROMPT = `You are an intake assistant for a medical clinic -- NOT the doctor and
not a clinician. You never diagnose, recommend treatment, or speak as if you are the one who will
examine the patient. If asked "are you the doctor," say clearly that you're the intake assistant
and a clinician will see them shortly. Your job is only to gather information, chart it, and get
them ready for the visit.

This is a SHARED device -- you do not know who you're talking to yet. Your very first step is to
ask for their name. As soon as they say ANY name -- first name only is fine, don't insist on a
full legal name or make them repeat themselves -- call identifyPatient with exactly what they said
right away. Never ask them to repeat or clarify their name before trying; try first, ask questions
only if identifyPatient comes back with a problem.

identifyPatient either confirms an existing patient or registers a brand-new one automatically --
either way, move straight into the visit once it returns "confirmed." If it's a new patient, welcome
them and mention this is their first visit here. If it finds multiple existing matches, briefly ask
for their date of birth and call identifyPatient again with both. One retry only -- don't loop on this.

Once identified, greet them warmly by first name and continue the intake. Ask short, natural
follow-up questions (1-2 sentences) about why they're here today. Keep every turn brief -- this is
a voice conversation, not a chat.

Call lookupHistory early in the conversation to pull relevant context from the patient's history,
and use it to ask personalized follow-ups instead of generic ones.

Whenever the patient states a symptom, condition, or allergy, call chartObservation immediately to
record it -- don't wait until the end of the conversation.

Once you've gathered a few symptoms, call runDifferential to produce a differential for the
clinician -- do this silently, don't narrate it to the patient.

Before wrapping up, you MUST call checkEligibility and then clearly tell the patient, in plain
language, whether the visit is covered and what their copay is (e.g. "Good news, you're covered
and your copay today is $25"). Do not end the conversation without doing this.

If you hear anything that sounds like a red-flag symptom or a possible drug interaction, call
flagRedFlag immediately so the clinician can review it before the visit.

When wrapping up, be clear that the clinician (not you) will review everything and see them
shortly -- never imply you are the one providing medical care.`;

export const IDENTIFY_PATIENT_FUNCTION = {
  name: 'identifyPatient',
  description: "Look up the patient by their spoken full name (and date of birth if given) to pull up their chart. Must be called first, before any other tool.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The patient\'s full name as they said it, plus date of birth if they gave one.' },
    },
    required: ['name'],
  },
};

export const CHART_OBSERVATION_FUNCTION = {
  name: 'chartObservation',
  description: 'Record a symptom, condition, or allergy the patient just mentioned into their chart.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['observation', 'condition', 'allergy'], description: 'Kind of clinical fact.' },
      value: { type: 'string', description: 'Plain-language description, e.g. "sore throat" or "penicillin allergy".' },
      code: { type: 'string', description: 'Optional SNOMED/LOINC code if known.' },
    },
    required: ['type', 'value'],
  },
};

export const LOOKUP_HISTORY_FUNCTION = {
  name: 'lookupHistory',
  description: "Semantically search the patient's history for context relevant to what they just said.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for, e.g. "blood sugar history".' },
    },
    required: ['query'],
  },
};

export const RUN_DIFFERENTIAL_FUNCTION = {
  name: 'runDifferential',
  description: "Produce a ranked, cited differential from the patient's charted symptoms and history so far.",
  parameters: { type: 'object', properties: {} },
};

export const CHECK_ELIGIBILITY_FUNCTION = {
  name: 'checkEligibility',
  description: "Verify the patient's insurance coverage and copay for this visit.",
  parameters: {
    type: 'object',
    properties: {
      serviceType: { type: 'string', description: 'Optional service type, e.g. "office visit".' },
    },
  },
};

export const FLAG_RED_FLAG_FUNCTION = {
  name: 'flagRedFlag',
  description: 'Draft an order or escalation for the clinician when you notice an actionable red-flag finding.',
  parameters: {
    type: 'object',
    properties: {
      finding: { type: 'string', description: 'The concerning finding, e.g. "chest pain radiating to left arm".' },
      action: { type: 'string', description: 'The drafted action, e.g. "Order ECG, escalate to urgent review".' },
    },
    required: ['finding', 'action'],
  },
};

export const ALL_TOOL_FUNCTIONS = [
  IDENTIFY_PATIENT_FUNCTION,
  CHART_OBSERVATION_FUNCTION,
  LOOKUP_HISTORY_FUNCTION,
  RUN_DIFFERENTIAL_FUNCTION,
  CHECK_ELIGIBILITY_FUNCTION,
  FLAG_RED_FLAG_FUNCTION,
];

export interface AgentSettings {
  type: 'Settings';
  audio: {
    input: { encoding: string; sample_rate: number };
    output: { encoding: string; sample_rate: number; container: string };
  };
  agent: {
    language: string;
    listen: { provider: { type: string; model: string } };
    think: {
      provider: { type: string; model: string; temperature?: number };
      prompt: string;
      functions?: unknown[];
    };
    speak: { provider: { type: string; model: string } };
    greeting?: string;
  };
}

export function buildAgentSettings(
  opts: {
    greeting?: string;
    prompt?: string;
    encoding?: 'linear16' | 'mulaw';
    sampleRate?: number;
    functions?: unknown[];
  } = {}
): AgentSettings {
  const encoding = opts.encoding ?? 'linear16';
  const sampleRate = opts.sampleRate ?? (encoding === 'mulaw' ? 8000 : 24000);

  return {
    type: 'Settings',
    audio: {
      input: { encoding, sample_rate: sampleRate },
      output: { encoding, sample_rate: sampleRate, container: 'none' },
    },
    agent: {
      language: 'en',
      listen: { provider: { type: 'deepgram', model: 'nova-3' } },
      think: {
        // Deepgram-hosted Anthropic passthrough -- no separate ANTHROPIC_API_KEY needed here.
        provider: { type: 'anthropic', model: 'claude-haiku-4-5', temperature: 0.4 },
        prompt: opts.prompt ?? SYSTEM_PROMPT,
        functions: opts.functions,
      },
      speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en' } },
      greeting: opts.greeting,
    },
  };
}
