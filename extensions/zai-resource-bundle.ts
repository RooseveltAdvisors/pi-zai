import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider, envApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ZAI_RESOURCE_BUNDLE_BASE_URL = "https://api.z.ai/api/paas/v4";
export const ZAI_RESOURCE_BUNDLE_PROVIDER_ID = "zai-resource-bundle";

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
    api: openAICompletionsApi(),
  });
}

export default function (pi: ExtensionAPI): void {
  pi.registerProvider(zaiResourceBundleProvider());
}
