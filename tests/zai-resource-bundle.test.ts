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
});
