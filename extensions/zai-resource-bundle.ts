import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createProvider, envApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ZAI_RESOURCE_BUNDLE_BASE_URL = "https://api.z.ai/api/paas/v4";
export const ZAI_RESOURCE_BUNDLE_PROVIDER_ID = "zai-resource-bundle";

type Input = ("text" | "image")[];

const compat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens" as const,
  thinkingFormat: "zai" as const,
  zaiToolStream: true,
};

const model = (
  id: string,
  name: string,
  input: Input = ["text"],
  maxTokens = 131072,
): Model<"openai-completions"> => ({
  id,
  name,
  api: "openai-completions",
  provider: ZAI_RESOURCE_BUNDLE_PROVIDER_ID,
  baseUrl: ZAI_RESOURCE_BUNDLE_BASE_URL,
  reasoning: true,
  input,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 204800,
  maxTokens,
  compat,
});

const models = [
  model("glm-5.1", "GLM-5.1"),
  model("glm-5-turbo", "GLM-5-Turbo"),
  model("glm-5", "GLM-5"),
  model("glm-4.7", "GLM-4.7"),
  model("glm-4.7-flash", "GLM-4.7 Flash"),
  model("glm-4.7-flashx", "GLM-4.7 FlashX"),
  model("glm-4.6", "GLM-4.6"),
  model("glm-4.5", "GLM-4.5", ["text"], 98304),
  model("glm-4.5-air", "GLM-4.5 Air", ["text"], 98304),
  model("glm-4.5-x", "GLM-4.5 X", ["text"], 98304),
  model("glm-4.5-airx", "GLM-4.5 AirX", ["text"], 98304),
  model("glm-4.5-flash", "GLM-4.5 Flash", ["text"], 98304),
  model("glm-4-32b-0414-128k", "GLM-4 32B 0414 128K", ["text"], 16384),
  model("glm-5v-turbo", "GLM-5V-Turbo", ["text", "image"]),
  model("glm-4.6v", "GLM-4.6V", ["text", "image"], 32768),
  model("glm-4.6v-flash", "GLM-4.6V Flash", ["text", "image"], 32768),
  model("glm-4.6v-flashx", "GLM-4.6V FlashX", ["text", "image"], 32768),
  model("glm-4.5v", "GLM-4.5V", ["text", "image"], 16384),
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
