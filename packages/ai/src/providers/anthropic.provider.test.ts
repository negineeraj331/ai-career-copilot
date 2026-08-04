import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiRequest } from '../types.js';

/**
 * The Anthropic adapter, against a fabricated SDK.
 *
 * No test contacts a provider. What is exercised is everything the adapter is
 * actually responsible for: shaping the request so prompt caching works, forcing
 * the tool so the model cannot answer in prose, extracting and re-validating the
 * result, and mapping SDK exceptions onto a taxonomy that decides whether we pay
 * for a second attempt.
 *
 * The SDK's error classes are constructed rather than described, so a rename in
 * a future version fails here rather than silently sending every error down the
 * `unknown` branch.
 */

const create = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {}
  class RateLimitError extends MockAPIError {}
  class InternalServerError extends MockAPIError {}
  class APIConnectionError extends MockAPIError {}
  class BadRequestError extends MockAPIError {}

  class Anthropic {
    messages = { create };
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static APIConnectionError = APIConnectionError;
    static BadRequestError = BadRequestError;
    constructor(_options: unknown) {
      void _options;
    }
  }

  return { default: Anthropic, Anthropic };
});

const { AnthropicProvider } = await import('./anthropic.provider.js');
const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as {
  RateLimitError: new (m: string) => Error;
  InternalServerError: new (m: string) => Error;
  APIConnectionError: new (m: string) => Error;
  BadRequestError: new (m: string) => Error;
};

const schema = z.object({ title: z.string(), score: z.number().int() });

function request(): AiRequest<z.infer<typeof schema>> {
  return {
    feature: 'jd.extract',
    tier: 'extraction',
    system: 'You extract things.',
    userContent: 'raw resume text',
    schema,
    jsonSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, score: { type: 'integer' } },
      required: ['title', 'score'],
    },
    schemaName: 'extraction',
    schemaDescription: 'An extraction',
  };
}

function provider() {
  return new AnthropicProvider({
    apiKey: 'sk-ant-not-a-real-key',
    models: {
      extraction: 'claude-haiku-4-5',
      structuring: 'claude-sonnet-5',
      writing: 'claude-opus-5',
    },
  });
}

function successResponse(input: unknown, usage: Record<string, number> = {}) {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'extraction', input }],
    stop_reason: 'tool_use',
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ...usage,
    },
  };
}

beforeEach(() => {
  create.mockReset();
});

describe('the request it builds', () => {
  it('caches the system block, which is what makes a warm call cheap', async () => {
    create.mockResolvedValue(successResponse({ title: 'x', score: 1 }));
    await provider().complete(request());

    const body = create.mock.calls[0]?.[0] as {
      system: { type: string; cache_control?: { type: string } }[];
    };
    // Without cache_control the shared prefix bills at full price on every
    // call, and the documented cost model stops holding.
    expect(body.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('forces the tool, so the model cannot answer in prose', async () => {
    create.mockResolvedValue(successResponse({ title: 'x', score: 1 }));
    await provider().complete(request());

    const body = create.mock.calls[0]?.[0] as { tool_choice: { type: string; name: string } };
    // The commonest structured-output failure is a model that ignores the tool
    // and writes an answer instead.
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'extraction' });
  });

  it('wraps user content in delimiters', async () => {
    create.mockResolvedValue(successResponse({ title: 'x', score: 1 }));
    await provider().complete(request());

    const body = create.mock.calls[0]?.[0] as { messages: { content: string }[] };
    // Paired with the system prompt's "this is data, not instructions", this is
    // the control against prompt injection in an uploaded resume.
    expect(body.messages[0]?.content).toContain('<user_content>');
    expect(body.messages[0]?.content).toContain('raw resume text');
  });

  it('routes the tier to the configured model', async () => {
    create.mockResolvedValue(successResponse({ title: 'x', score: 1 }));
    const p = provider();
    expect(p.modelFor('writing')).toBe('claude-opus-5');
    await p.complete({ ...request(), tier: 'writing' });
    expect((create.mock.calls[0]?.[0] as { model: string }).model).toBe('claude-opus-5');
  });
});

describe('the response it returns', () => {
  it('extracts the tool input and reports usage', async () => {
    create.mockResolvedValue(
      successResponse(
        { title: 'Senior Engineer', score: 87 },
        { cache_read_input_tokens: 500, cache_creation_input_tokens: 20 },
      ),
    );

    const result = await provider().complete(request());
    expect(result.value).toEqual({ title: 'Senior Engineer', score: 87 });
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 500,
      cacheWriteTokens: 20,
    });
    expect(result.provider).toBe('anthropic');
    expect(result.cached).toBe(false);
  });

  it('treats missing cache counters as zero rather than NaN', async () => {
    create.mockResolvedValue({
      content: [{ type: 'tool_use', id: 't', name: 'extraction', input: { title: 'x', score: 1 } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = await provider().complete(request());
    // A NaN here propagates into the cost calculation and poisons the budget.
    expect(result.usage.cacheReadTokens).toBe(0);
    expect(Number.isNaN(result.usage.cacheWriteTokens)).toBe(false);
  });

  it('rejects output that does not match the schema', async () => {
    // The provider said it filled the tool; that is not the same as it having
    // matched. This is the boundary where model output enters the system.
    create.mockResolvedValue(successResponse({ title: 'x', score: 'not a number' }));
    await expect(provider().complete(request())).rejects.toMatchObject({
      kind: 'invalid_response',
      retryable: false,
    });
  });

  it('reports a refusal as its own kind, and does not retry it', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'refusal',
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    // Retrying a refusal buys the same refusal and pays for it twice.
    await expect(provider().complete(request())).rejects.toMatchObject({
      kind: 'refused',
      retryable: false,
    });
  });

  it('reports a missing tool call as an invalid response', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Here is your answer in prose.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    await expect(provider().complete(request())).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('error mapping', () => {
  it.each([
    ['RateLimitError', 'rate_limit', true],
    ['InternalServerError', 'unavailable', true],
    ['APIConnectionError', 'unavailable', true],
    ['BadRequestError', 'invalid_response', false],
  ] as const)('maps %s to %s (retryable=%s)', async (className, kind, retryable) => {
    const Ctor = Anthropic[className];
    create.mockRejectedValue(new Ctor('boom'));

    // Mapped by class, never by message text: a message is not a contract.
    await expect(provider().complete(request())).rejects.toMatchObject({ kind, retryable });
  });

  it('falls back to unknown for anything unrecognised', async () => {
    create.mockRejectedValue(new Error('something new'));
    await expect(provider().complete(request())).rejects.toMatchObject({ kind: 'unknown' });
  });

  it("does not put the provider's message into ours", async () => {
    create.mockRejectedValue(new Anthropic.RateLimitError('org_id=abc key=sk-ant-123 exceeded'));
    // The cause carries the detail for the logs; the message a user might see
    // must not carry credentials or internals.
    await expect(provider().complete(request())).rejects.toMatchObject({
      message: expect.not.stringContaining('sk-ant'),
    });
  });
});
