import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  createProvider,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type ApiKeyAuth,
  type Model,
  type Provider,
  type ProviderStreams,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ZAI_GENERAL_BASE_URL = "https://api.z.ai/api/paas/v4";
export const ZAI_GENERAL_PROVIDER_ID = "zai-general";
const GLM_45V_MODEL_ID = "glm-4.5v";

const THINKING_OPEN_TAGS = ["<think>", "<|begin_of_think|>", "<|begin_of_thought|>", "<reasoning>"];
const THINKING_CLOSE_TAGS = ["</think>", "<|end_of_think|>", "<|end_of_thought|>", "</reasoning>"];
const REMOVED_TAGS = [
  ...THINKING_OPEN_TAGS,
  ...THINKING_CLOSE_TAGS,
  "<answer>",
  "</answer>",
  "<|begin_of_box|>",
  "<|end_of_box|>",
];

type TagFilterState = {
  thinkingDepth: number;
  pending: string;
  rawLength: number;
  text: string;
};

function createTagFilterState(): TagFilterState {
  return { thinkingDepth: 0, pending: "", rawLength: 0, text: "" };
}

function matchesTagAt(value: string, offset: number, tag: string): boolean {
  if (value.length - offset < tag.length) return false;
  for (let index = 0; index < tag.length; index += 1) {
    const valueCode = value.charCodeAt(offset + index);
    const tagCode = tag.charCodeAt(index);
    if (valueCode === tagCode) continue;
    if (valueCode < 65 || valueCode > 90 || valueCode + 32 !== tagCode) return false;
  }
  return true;
}

function matchesTagPrefixAt(value: string, offset: number, tag: string): boolean {
  const length = value.length - offset;
  if (length === 0 || length >= tag.length) return false;
  for (let index = 0; index < length; index += 1) {
    const valueCode = value.charCodeAt(offset + index);
    const tagCode = tag.charCodeAt(index);
    if (valueCode === tagCode) continue;
    if (valueCode < 65 || valueCode > 90 || valueCode + 32 !== tagCode) return false;
  }
  return true;
}

function matchingTagAt(value: string, offset: number): string | undefined {
  return REMOVED_TAGS.find((tag) => matchesTagAt(value, offset, tag));
}

function hasPartialTagAt(value: string, offset: number): boolean {
  return value.charCodeAt(offset) === 60 && REMOVED_TAGS.some((tag) => matchesTagPrefixAt(value, offset, tag));
}

function consumeText(state: TagFilterState, chunk: string): string {
  state.rawLength += chunk.length;
  const input = state.pending + chunk;
  state.pending = "";
  let visible = "";
  let cursor = 0;
  let segmentStart = 0;

  while (cursor < input.length) {
    const tag = matchingTagAt(input, cursor);
    if (tag) {
      if (state.thinkingDepth === 0) visible += input.slice(segmentStart, cursor);
      if (THINKING_OPEN_TAGS.includes(tag)) state.thinkingDepth += 1;
      if (THINKING_CLOSE_TAGS.includes(tag)) state.thinkingDepth = Math.max(0, state.thinkingDepth - 1);
      cursor += tag.length;
      segmentStart = cursor;
      continue;
    }
    if (hasPartialTagAt(input, cursor)) {
      if (state.thinkingDepth === 0) visible += input.slice(segmentStart, cursor);
      state.pending = input.slice(cursor);
      break;
    }
    cursor += 1;
  }

  if (cursor === input.length && state.thinkingDepth === 0) visible += input.slice(segmentStart);
  state.text += visible;
  return visible;
}

function finishText(state: TagFilterState): string {
  if (state.thinkingDepth === 0) state.text += state.pending;
  state.pending = "";
  state.thinkingDepth = 0;
  return state.text;
}

function sanitizeStandaloneText(text: string): string {
  const state = createTagFilterState();
  consumeText(state, text);
  return finishText(state);
}

function sanitizeMessage(
  message: AssistantMessage,
  states: Map<number, TagFilterState>,
  finalize = false,
): AssistantMessage {
  return {
    ...message,
    content: message.content.map((block, index) => {
      if (block.type !== "text") return block;
      const state = states.get(index);
      const text = state
        ? finalize
          ? finishText(state)
          : state.text
        : sanitizeStandaloneText(block.text);
      return { ...block, text };
    }),
  };
}

function sanitizeEvent(
  event: AssistantMessageEvent,
  states: Map<number, TagFilterState>,
): AssistantMessageEvent | undefined {
  switch (event.type) {
    case "start":
      return { ...event, partial: sanitizeMessage(event.partial, states) };
    case "text_start": {
      states.set(event.contentIndex, createTagFilterState());
      return { ...event, partial: sanitizeMessage(event.partial, states) };
    }
    case "text_delta": {
      const state = states.get(event.contentIndex) ?? createTagFilterState();
      states.set(event.contentIndex, state);
      const delta = consumeText(state, event.delta);
      if (delta.length === 0) return undefined;
      return { ...event, delta, partial: sanitizeMessage(event.partial, states) };
    }
    case "text_end": {
      const state = states.get(event.contentIndex) ?? createTagFilterState();
      states.set(event.contentIndex, state);
      if (event.content.length > state.rawLength) {
        consumeText(state, event.content.slice(state.rawLength));
      }
      const content = finishText(state);
      return { ...event, content, partial: sanitizeMessage(event.partial, states) };
    }
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      return { ...event, partial: sanitizeMessage(event.partial, states) };
    case "done":
      return { ...event, message: sanitizeMessage(event.message, states, true) };
    case "error":
      return { ...event, error: sanitizeMessage(event.error, states, true) };
  }
}

function createSanitizationError(
  model: { api: string; id: string; provider: string },
  error: unknown,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api as Api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

function sanitizeGlm45vStream(
  model: { api: string; id: string; provider: string },
  source: ReturnType<typeof createAssistantMessageEventStream>,
): ReturnType<typeof createAssistantMessageEventStream> {
  if (model.id !== GLM_45V_MODEL_ID) return source;

  const target = createAssistantMessageEventStream();
  const states = new Map<number, TagFilterState>();
  void (async () => {
    try {
      for await (const event of source) {
        const sanitized = sanitizeEvent(event, states);
        if (sanitized) target.push(sanitized);
      }
      target.end();
    } catch (error) {
      console.error("Failed to sanitize GLM-4.5V response", error);
      target.push({ type: "error", reason: "error", error: createSanitizationError(model, error) });
      target.end();
    }
  })();
  return target;
}

function withThinkingDisabled(options: StreamOptions | undefined): StreamOptions {
  return {
    ...(options ?? {}),
    samplingParams: {
      ...(options?.samplingParams ?? {}),
      thinking: { type: "disabled" },
    },
  };
}

function zaiGeneralApi(): ProviderStreams {
  const streams = openAICompletionsApi();
  return {
    stream: (model, context, options) => {
      const requestOptions = model.id === GLM_45V_MODEL_ID ? withThinkingDisabled(options) : options;
      return sanitizeGlm45vStream(model, streams.stream(model, context, requestOptions));
    },
    streamSimple: (model, context, options) => {
      const requestOptions = model.id === GLM_45V_MODEL_ID ? withThinkingDisabled(options) : options;
      return sanitizeGlm45vStream(model, streams.streamSimple(model, context, requestOptions));
    },
  };
}

type Input = ("text" | "image")[];

type ModelOptions = {
  input?: Input;
  maxTokens?: number;
  contextWindow?: number;
  reasoning?: boolean;
  samplingParams?: Record<string, unknown>;
  zaiToolStream?: boolean;
};

const compat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens" as const,
  thinkingFormat: "zai" as const,
};

const model = (
  id: string,
  name: string,
  {
    input = ["text"],
    maxTokens = 131072,
    contextWindow = 204800,
    reasoning = true,
    samplingParams,
    zaiToolStream = false,
  }: ModelOptions = {},
): Model<"openai-completions"> => ({
  id,
  name,
  api: "openai-completions",
  provider: ZAI_GENERAL_PROVIDER_ID,
  baseUrl: ZAI_GENERAL_BASE_URL,
  reasoning,
  input,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow,
  maxTokens,
  ...(samplingParams ? { samplingParams } : {}),
  compat: { ...compat, zaiToolStream },
});

type ZaiModelResponse = {
  id?: unknown;
  name?: unknown;
  context_window?: unknown;
  max_tokens?: unknown;
};

type ZaiModelsResponse = { data?: ZaiModelResponse[] };

const NON_CHAT_MODEL = /(image|audio|video|tts|asr|embed|embedding|vector|rerank|cogview|realtime)/i;

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function prettyName(id: string): string {
  return /^glm/i.test(id) ? id.toUpperCase() : id;
}

function modelFromApi(entry: ZaiModelResponse): Model<"openai-completions"> | undefined {
  if (typeof entry.id !== "string" || !entry.id || NON_CHAT_MODEL.test(entry.id)) return undefined;

  const id = entry.id;
  const isVision = /(?:^|[-.])v(?:[-.]|$)|vision/i.test(id);
  const isGlm45v = id.toLowerCase() === GLM_45V_MODEL_ID;
  const isReasoning = !/(flash|air|airx|32b|4\.5v)/i.test(id);
  const isToolStreamCompatible = /^(?:glm-5(?:\.1)?$|glm-4\.7(?:-.*)?$|glm-4\.6$)/i.test(id);
  const defaults = isGlm45v
    ? { maxTokens: 16384, contextWindow: 65536 }
    : /4\.5|4-32b/i.test(id)
      ? { maxTokens: /4-32b/i.test(id) ? 16384 : 98304, contextWindow: 131072 }
      : isVision
        ? { maxTokens: 32768, contextWindow: 131072 }
        : { maxTokens: 131072, contextWindow: 204800 };

  return model(id, typeof entry.name === "string" && entry.name ? entry.name : prettyName(id), {
    input: isVision ? ["text", "image"] : ["text"],
    maxTokens: positiveNumber(entry.max_tokens) ?? defaults.maxTokens,
    contextWindow: positiveNumber(entry.context_window) ?? defaults.contextWindow,
    reasoning: isGlm45v ? false : isReasoning,
    ...(isGlm45v ? { samplingParams: { thinking: { type: "disabled" } } } : {}),
    zaiToolStream: isToolStreamCompatible,
  });
}

export function modelsFromZaiResponse(response: ZaiModelsResponse): Model<"openai-completions">[] {
  return (response.data ?? []).flatMap((entry) => {
    const parsed = modelFromApi(entry);
    return parsed ? [parsed] : [];
  });
}

export async function fetchZaiModels(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Model<"openai-completions">[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchFn(`${ZAI_GENERAL_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const models = modelsFromZaiResponse((await response.json()) as ZaiModelsResponse);
    if (!models.length) throw new Error("No chat models in response");
    return models;
  } finally {
    clearTimeout(timeout);
  }
}

function storedZaiApiKey(): string | undefined {
  const credential = readStoredCredential("zai");
  return credential?.type === "api_key" ? credential.key : undefined;
}

function zaiGeneralApiKeyAuth(apiKey: string | undefined): ApiKeyAuth {
  return {
    name: "Z.AI API key",
    resolve: async ({ ctx, signal }) => {
      signal.throwIfAborted();
      const key = apiKey ?? (await ctx.env("ZAI_API_KEY"));
      return key ? { auth: { apiKey: key }, source: apiKey ? "stored zai credential" : "ZAI_API_KEY" } : undefined;
    },
  };
}

export function zaiGeneralProvider(
  models: readonly Model<"openai-completions">[] = [],
  apiKey?: string,
): Provider<"openai-completions"> {
  return createProvider({
    id: ZAI_GENERAL_PROVIDER_ID,
    name: "Z.AI General API",
    baseUrl: ZAI_GENERAL_BASE_URL,
    auth: { apiKey: zaiGeneralApiKeyAuth(apiKey) },
    models,
    api: zaiGeneralApi(),
  });
}

export default async function (pi: ExtensionAPI): Promise<void> {
  let models: Model<"openai-completions">[] = [];
  const apiKey = storedZaiApiKey() ?? process.env.ZAI_API_KEY;
  if (apiKey) {
    try {
      models = await fetchZaiModels(apiKey);
    } catch (error) {
      console.warn("Failed to fetch Z.AI model catalog", error);
    }
  }
  pi.registerProvider(zaiGeneralProvider(models, apiKey));
}
