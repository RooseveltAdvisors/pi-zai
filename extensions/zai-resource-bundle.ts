import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  createAssistantMessageEventStream,
  createProvider,
  envApiKeyAuth,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
  type Provider,
  type ProviderStreams,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ZAI_RESOURCE_BUNDLE_BASE_URL = "https://api.z.ai/api/paas/v4";
export const ZAI_RESOURCE_BUNDLE_PROVIDER_ID = "zai-resource-bundle";
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

function zaiResourceBundleApi(): ProviderStreams {
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
  provider: ZAI_RESOURCE_BUNDLE_PROVIDER_ID,
  baseUrl: ZAI_RESOURCE_BUNDLE_BASE_URL,
  reasoning,
  input,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow,
  maxTokens,
  ...(samplingParams ? { samplingParams } : {}),
  compat: { ...compat, zaiToolStream },
});

const models = [
  model("glm-5.1", "GLM-5.1", { zaiToolStream: true }),
  model("glm-5-turbo", "GLM-5-Turbo"),
  model("glm-5", "GLM-5", { zaiToolStream: true }),
  model("glm-4.7", "GLM-4.7", { zaiToolStream: true }),
  model("glm-4.7-flash", "GLM-4.7 Flash", { zaiToolStream: true }),
  model("glm-4.7-flashx", "GLM-4.7 FlashX", { zaiToolStream: true }),
  model("glm-4.6", "GLM-4.6", { zaiToolStream: true }),
  model("glm-4.5", "GLM-4.5", { maxTokens: 98304, contextWindow: 131072 }),
  model("glm-4.5-air", "GLM-4.5 Air", { maxTokens: 98304, contextWindow: 131072 }),
  model("glm-4.5-x", "GLM-4.5 X", { maxTokens: 98304, contextWindow: 131072 }),
  model("glm-4.5-airx", "GLM-4.5 AirX", { maxTokens: 98304, contextWindow: 131072 }),
  model("glm-4.5-flash", "GLM-4.5 Flash", { maxTokens: 98304, contextWindow: 131072 }),
  model("glm-4-32b-0414-128k", "GLM-4 32B 0414 128K", {
    maxTokens: 16384,
    contextWindow: 131072,
    reasoning: false,
  }),
  model("glm-5v-turbo", "GLM-5V-Turbo", { input: ["text", "image"] }),
  model("glm-4.6v", "GLM-4.6V", {
    input: ["text", "image"],
    maxTokens: 32768,
    contextWindow: 131072,
  }),
  model("glm-4.6v-flash", "GLM-4.6V Flash", {
    input: ["text", "image"],
    maxTokens: 32768,
    contextWindow: 131072,
  }),
  model("glm-4.6v-flashx", "GLM-4.6V FlashX", {
    input: ["text", "image"],
    maxTokens: 32768,
    contextWindow: 131072,
  }),
  model("glm-4.5v", "GLM-4.5V", {
    input: ["text", "image"],
    maxTokens: 16384,
    contextWindow: 65536,
    reasoning: false,
    samplingParams: { thinking: { type: "disabled" } },
  }),
] as const;

export function zaiResourceBundleProvider(): Provider<"openai-completions"> {
  return createProvider({
    id: ZAI_RESOURCE_BUNDLE_PROVIDER_ID,
    name: "Z.AI Resource Bundle",
    baseUrl: ZAI_RESOURCE_BUNDLE_BASE_URL,
    auth: { apiKey: envApiKeyAuth("Z.AI API key", ["ZAI_API_KEY"]) },
    models,
  api: zaiResourceBundleApi(),
  });
}

export default function (pi: ExtensionAPI): void {
  pi.registerProvider(zaiResourceBundleProvider());
}
