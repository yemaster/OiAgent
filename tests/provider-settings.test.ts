import { expect, it } from "vitest";
import { providerDraft } from "@/lib/providers";
import {
  importProviderSettings,
  providerSettings,
  hasOneM,
  stripOneM,
  withOneM,
} from "@/lib/providerSettings";
import sample from "./fixtures/claude-provider-settings.json";

it("round trips native settings without conflating the startup model, env model, or credential storage", () => {
  const draft = importProviderSettings(providerDraft(), JSON.stringify(sample));
  expect(draft.profile).toMatchObject({
    name: "gateway.example.test",
    baseUrl: sample.env.ANTHROPIC_BASE_URL,
    authType: "auth-token",
    defaultModel: "deepseek-flash[1M]",
    fableModel: "deepseek-flash[1M]",
    settings: {
      model: "claude-fable-5",
      enabledPlugins: sample.enabledPlugins,
    },
  });
  expect(draft.apiKey).toBe("fixture-token");
  expect(JSON.stringify(draft.profile)).not.toContain("fixture-token");
  expect(providerSettings(draft)).toEqual(sample);
});
it("preserves unsupported settings and false values, without modifying the input draft", () => {
  const initial = providerDraft();
  const value = {
    ...sample,
    futureOption: { list: [false, 0, "value"] },
    skipWebFetchPreflight: false,
  };
  const draft = importProviderSettings(initial, JSON.stringify(value));
  expect(providerSettings(draft)).toEqual(value);
  expect(initial.profile.settings).toBeUndefined();
  expect(initial.apiKey).toBe("");
});
it("rejects malformed configuration atomically without echoing pasted secrets", () => {
  const initial = providerDraft();
  for (const value of [
    '{"secret":"private-fixture",',
    "[]",
    '{"env":[]}',
    '{"env":{"ANY":1}}',
    '{"enabledPlugins":{"plugin":"yes"}}',
    '{"skipDangerousModePermissionPrompt":"true"}',
  ]) {
    expect(() => importProviderSettings(initial, value)).toThrow();
    try {
      importProviderSettings(initial, value);
    } catch (error) {
      expect(String(error)).not.toContain("private-fixture");
    }
  }
  expect(initial.apiKey).toBe("");
});
it("does not carry an unsaved key to another service and handles both authentication types", () => {
  const initial = importProviderSettings(
    providerDraft(),
    JSON.stringify(sample),
  );
  const withoutKey = {
    env: { ANTHROPIC_BASE_URL: "https://other.example.test" },
  };
  expect(
    importProviderSettings(initial, JSON.stringify(withoutKey)).apiKey,
  ).toBe("");
  const key = importProviderSettings(
    initial,
    JSON.stringify({ env: { ANTHROPIC_API_KEY: "official-fixture" } }),
  );
  expect(key.profile.authType).toBe("api-key");
  expect(key.apiKey).toBe("official-fixture");
  expect(JSON.stringify(key.profile)).not.toContain("official-fixture");
  expect(() =>
    importProviderSettings(
      initial,
      JSON.stringify({
        env: { ANTHROPIC_API_KEY: "a", ANTHROPIC_AUTH_TOKEN: "b" },
      }),
    ),
  ).toThrow(/一种鉴权/);
});
it("toggles 1M once, accepts either casing, and leaves plain model IDs intact", () => {
  expect(hasOneM("deepseek-flash[1m]")).toBe(true);
  expect(withOneM("deepseek-flash[1M]", true)).toBe("deepseek-flash[1M]");
  expect(withOneM("deepseek-flash[1m]", false)).toBe("deepseek-flash");
  expect(withOneM("", true)).toBe("");
  expect(stripOneM("family/model-name")).toBe("family/model-name");
});
