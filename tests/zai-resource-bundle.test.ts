import { describe, expect, test } from "bun:test";
import {
  ZAI_RESOURCE_BUNDLE_BASE_URL,
  zaiResourceBundleProvider,
} from "../extensions/zai-resource-bundle.ts";

describe("Z.AI Resource Bundle provider", () => {
  test("uses the general PaaS v4 endpoint", () => {
    const provider = zaiResourceBundleProvider();

    expect(provider.baseUrl).toBe(ZAI_RESOURCE_BUNDLE_BASE_URL);
    expect(provider.baseUrl).toBe("https://api.z.ai/api/paas/v4");
    expect(provider.baseUrl).not.toContain("/coding/paas/v4");
    expect(provider.getModels().every((model) => model.baseUrl === ZAI_RESOURCE_BUNDLE_BASE_URL)).toBe(true);
  });

  test("advertises model-specific limits and compatibility", () => {
    const models = Object.fromEntries(zaiResourceBundleProvider().getModels().map((model) => [model.id, model]));

    expect(models["glm-4.7"].compat?.zaiToolStream).toBe(true);
    expect(models["glm-4.5"]).toMatchObject({
      contextWindow: 131072,
      compat: { zaiToolStream: false },
    });
    expect(models["glm-4.6v"]).toMatchObject({
      contextWindow: 131072,
      compat: { zaiToolStream: false },
    });
    expect(models["glm-4.5v"]).toMatchObject({
      contextWindow: 65536,
      compat: { zaiToolStream: false },
    });
    expect(models["glm-4-32b-0414-128k"]).toMatchObject({
      reasoning: false,
      contextWindow: 131072,
      compat: { zaiToolStream: false },
    });
  });
});
