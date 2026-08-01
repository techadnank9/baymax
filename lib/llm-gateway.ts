// Hackathon-provided LLM gateway (a1mobile), not Anthropic directly -- spec called for Claude
// Sonnet 5 via @anthropic-ai/sdk, but no Anthropic key was available. This substitutes the
// working credential: an OpenAI-compatible Responses API proxying to openai.gpt-5.6-sol.
// The gw/v1/chat/completions path 404'd during testing; the raw Responses API endpoint below
// is the one confirmed live.
const RESPONSES_URL = 'https://h3zqfzovcybu5annkciuqf47mu0cbczd.lambda-url.us-east-2.on.aws/openai/v1/responses';
export const GATEWAY_MODEL = 'openai.gpt-5.6-sol';

export async function generateText(instructions: string, input: string): Promise<string> {
  // This gateway's Responses API rejects the "instructions" field ("instructions is not
  // supported") -- fold system guidance into `input` instead.
  const res = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_GATEWAY_KEY}`,
    },
    body: JSON.stringify({ model: GATEWAY_MODEL, input: `${instructions}\n\n${input}` }),
  });

  if (!res.ok) {
    throw new Error(`LLM gateway request failed: HTTP ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const message = (data.output ?? []).find((o: any) => o.type === 'message');
  const textBlock = message?.content?.find((c: any) => c.type === 'output_text');
  if (!textBlock?.text) {
    throw new Error('No text content in gateway response: ' + JSON.stringify(data).slice(0, 500));
  }
  return textBlock.text;
}
