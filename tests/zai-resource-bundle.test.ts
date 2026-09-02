import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  ZAI_RESOURCE_BUNDLE_BASE_URL,
  fetchZaiModels,
  zaiResourceBundleProvider,
} from "../extensions/zai-resource-bundle.ts";

const catalog = {
  data: [
    { id: "glm-4.7" },
    { id: "glm-5-turbo" },
    { id: "glm-4.5", context_window: 131072 },
    { id: "glm-4.5-flash", context_window: 131072 },
    { id: "glm-4.6v", context_window: 131072 },
    { id: "glm-4.5v", context_window: 65536 },
    { id: "glm-4-32b-0414-128k", context_window: 131072 },
    { id: "cogview-4" },
  ],
};

async function testProvider() {
  const models = await fetchZaiModels("test-key", async (input, init) => {
    expect(input).toBe(`${ZAI_RESOURCE_BUNDLE_BASE_URL}/models`);
    expect(init?.headers).toEqual({ Authorization: "Bearer test-key" });
    return new Response(JSON.stringify(catalog), { status: 200 });
  });
  return zaiResourceBundleProvider(models);
}

describe("Z.AI Resource Bundle provider", () => {
  test("uses the general PaaS v4 endpoint", () => {
    const provider = zaiResourceBundleProvider();

    expect(provider.baseUrl).toBe(ZAI_RESOURCE_BUNDLE_BASE_URL);
    expect(provider.baseUrl).toBe("https://api.z.ai/api/paas/v4");
    expect(provider.baseUrl).not.toContain("/coding/paas/v4");
  });

  test("loads the live catalog from the general PaaS models endpoint", async () => {
    const provider = await testProvider();
    const models = provider.getModels();

    expect(models.map((model) => model.id)).not.toContain("cogview-4");
    expect(models).toHaveLength(7);
    expect(models.every((model) => model.baseUrl === ZAI_RESOURCE_BUNDLE_BASE_URL)).toBe(true);
    expect(models.find((model) => model.id === "glm-4.7")?.name).toBe("GLM-4.7");
  });

  test("advertises model-specific limits and compatibility", async () => {
    const models = Object.fromEntries((await testProvider()).getModels().map((model) => [model.id, model]));

    expect(models["glm-4.7"].compat?.zaiToolStream).toBe(true);
    expect(models["glm-5-turbo"].compat?.zaiToolStream).toBe(false);
    expect(models["glm-4.5"]).toMatchObject({
      contextWindow: 131072,
      compat: { zaiToolStream: false },
    });
    expect(models["glm-4.5-flash"].contextWindow).toBe(131072);
    expect(models["glm-4.6v"]).toMatchObject({
      contextWindow: 131072,
      compat: { zaiToolStream: false },
    });
    expect(models["glm-4.5v"]).toMatchObject({
      reasoning: false,
      contextWindow: 65536,
      samplingParams: { thinking: { type: "disabled" } },
      compat: { zaiToolStream: false },
    });
    expect(models["glm-4-32b-0414-128k"]).toMatchObject({
      reasoning: false,
      contextWindow: 131072,
      compat: { zaiToolStream: false },
    });
  });

  test("filters GLM-4.5V thinking safely at the API boundary", async () => {
    const provider = await testProvider();
    const model = provider.getModels().find((entry) => entry.id === "glm-4.5v");
    expect(model).toBeDefined();

    let requestBody: Record<string, unknown> | undefined;
    const responseBody = [
      `data: ${JSON.stringify({
        id: "response",
        model: "glm-4.5v",
        choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        id: "response",
        model: "glm-4.5v",
        choices: [{ index: 0, delta: { content: "<think>outer<think>inner</think>still-private</think><|begin_of_thought|>also-private<|end_of_thought|>" }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        id: "response",
        model: "glm-4.5v",
        choices: [{ index: 0, delta: { content: "<thi" }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        id: "response",
        model: "glm-4.5v",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const stream = provider.streamSimple(
      model!,
      { messages: [{ role: "user", content: "hello", timestamp: 0 }] },
      {
        apiKey: "test-key",
        fetch: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(responseBody, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        },
      },
    );

    const visibleDeltas: string[] = [];
    let firstPartial: AssistantMessage | undefined;
    for await (const event of stream) {
      if (event.type === "text_delta") {
        visibleDeltas.push(event.delta);
        firstPartial ??= event.partial;
      }
    }
    const response = await stream.result();

    expect(requestBody?.thinking).toEqual({ type: "disabled" });
    expect(visibleDeltas.join("")).toBe("answer");
    expect(firstPartial?.content).toEqual([{ type: "text", text: "answer" }]);
    expect(response.content).toEqual([{ type: "text", text: "answer<thi" }]);
  });
});
