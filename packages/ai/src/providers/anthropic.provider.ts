import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  type AiCallResult,
  type AiProvider,
  type AiRequest,
  type ModelTier,
} from '../types.js';

/**
 * The Anthropic adapter.
 *
 * Structured output comes from a tool with a **forced `tool_choice`**, not from
 * asking for JSON in the prompt and parsing the reply. A model asked politely
 * for JSON will occasionally wrap it in prose, and that failure surfaces as a
 * parse error on a call the user has already paid for.
 *
 * The SDK also offers `strict: true`, which constrains generation to the schema
 * rather than merely requesting it — but in @anthropic-ai/sdk 0.71 that field
 * exists **only on the beta messages API**, checked against the installed
 * type definitions rather than recalled. Putting a beta endpoint on the path
 * that spends money did not seem worth it when the GA path plus validation
 * reaches the same end state: the rare non-conforming response is caught here
 * and reported as non-retryable, so it costs one call rather than looping.
 * Worth revisiting the moment `strict` reaches GA — recorded in docs/tracker.md.
 *
 * The result is validated against the Zod schema regardless. "The provider says
 * it matched" is not "it matched", and this is the boundary where model output
 * enters the system.
 */

export interface AnthropicProviderOptions {
  apiKey: string;
  models: Record<ModelTier, string>;
  maxRetries?: number;
  timeoutMs?: number;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly models: Record<ModelTier, string>;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // The SDK retries idempotent failures itself. Two is enough: a third
      // attempt on a provider outage adds latency to a request that is going to
      // fail anyway, and the circuit breaker above is the right place to give up.
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 60_000,
    });
    this.models = options.models;
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  async complete<T>(request: AiRequest<T>): Promise<AiCallResult<T>> {
    const model = this.modelFor(request.tier);
    const startedAt = Date.now();

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 4096,
        // An array with `cache_control` rather than a bare string: the system
        // block is identical across calls for a feature, so caching it bills
        // the shared prefix at ~0.1× on every repeat. This is the saving the
        // ₹35/user/month budget in docs/11 assumes.
        system: [
          {
            type: 'text' as const,
            text: request.system,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: [
          {
            role: 'user' as const,
            // Delimited, and the system prompt states that everything inside is
            // data. Prompt injection in an uploaded resume is a listed threat
            // (docs/11 §10); the schema-validated response is what stops an
            // injected instruction changing the response shape.
            content: `<user_content>\n${request.userContent}\n</user_content>`,
          },
        ],
        tools: [
          {
            name: request.schemaName,
            description: request.schemaDescription,
            input_schema: request.jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        // Forced: without this the model may answer in prose and skip the tool
        // entirely, which is the single commonest structured-output failure.
        tool_choice: { type: 'tool', name: request.schemaName },
      });
    } catch (error) {
      throw toProviderError(error);
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      // `stop_reason: 'refusal'` is the provider declining, which is a real
      // outcome for abusive input and must not be retried — it will decline
      // again, and each attempt costs money.
      if (response.stop_reason === 'refusal') {
        throw new AiProviderError('refused', 'The model declined to answer this request.');
      }
      throw new AiProviderError(
        'invalid_response',
        'The model did not return the structured output it was asked for.',
      );
    }

    const parsed = request.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new AiProviderError(
        'invalid_response',
        `The model returned output that did not match the ${request.schemaName} schema.`,
        { cause: parsed.error },
      );
    }

    return {
      value: parsed.data,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
      model,
      provider: this.name,
      latencyMs: Date.now() - startedAt,
      cached: false,
    };
  }
}

/**
 * Maps SDK errors onto our own taxonomy by class, never by string matching.
 * Message text is not a contract; the exception classes are.
 */
function toProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('rate_limit', 'The AI provider is rate limiting us.', {
      cause: error,
    });
  }
  if (
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new AiProviderError('unavailable', 'The AI provider is unavailable.', { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Our fault, not theirs — a malformed schema or an oversized prompt. No
    // retry: it will be malformed the second time too.
    return new AiProviderError('invalid_response', 'The AI request was rejected as invalid.', {
      retryable: false,
      cause: error,
    });
  }

  return new AiProviderError('unknown', 'The AI request failed.', { cause: error });
}
