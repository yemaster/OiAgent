import type { ProviderDraft } from "./providers";
import type { ProviderProfile } from "./types";

export const modelFields = [
  ["defaultModel", "ANTHROPIC_MODEL", "默认模型"],
  ["sonnetModel", "ANTHROPIC_DEFAULT_SONNET_MODEL", "Sonnet"],
  ["opusModel", "ANTHROPIC_DEFAULT_OPUS_MODEL", "Opus"],
  ["fableModel", "ANTHROPIC_DEFAULT_FABLE_MODEL", "Fable"],
  ["haikuModel", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "Haiku"],
] as const;
export const hasOneM = (value: string) => /\[1m\]\s*$/i.test(value);
export const stripOneM = (value: string) =>
  value.replace(/\[1m\]\s*$/i, "").trimEnd();
export const withOneM = (value: string, enabled: boolean) => {
  const base = stripOneM(value).trim();
  return base && enabled ? `${base}[1M]` : base;
};
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const providerEnv = (profile: ProviderProfile) =>
  object(profile.settings?.env);
export const envText = (profile: ProviderProfile, key: string) => {
  const value = providerEnv(profile)[key];
  return typeof value === "string" ? value : "";
};
export function setProviderEnv(
  profile: ProviderProfile,
  key: string,
  value: string,
): ProviderProfile {
  const env = { ...providerEnv(profile) };
  if (value) env[key] = value;
  else delete env[key];
  const settings = { ...profile.settings, env };
  return { ...profile, settings };
}

/** Reconstruct native settings without reading or exposing a previously saved key. */
export function providerSettings(
  draft: ProviderDraft,
): Record<string, unknown> {
  const env = {
    ...providerEnv(draft.profile),
    ANTHROPIC_BASE_URL: draft.profile.baseUrl,
  } as Record<string, unknown>;
  for (const [field, key] of modelFields)
    if (draft.profile[field]) env[key] = draft.profile[field];
  if (draft.apiKey)
    env[
      draft.profile.authType === "api-key"
        ? "ANTHROPIC_API_KEY"
        : "ANTHROPIC_AUTH_TOKEN"
    ] = draft.apiKey;
  return { ...draft.profile.settings, env };
}

/** Parse atomically; credentials leave the JSON and follow the existing encrypted key path. */
export function importProviderSettings(
  draft: ProviderDraft,
  text: string,
): ProviderDraft {
  if (text.length > 512 * 1024) throw new Error("配置不能超过 512 KB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("JSON 格式错误，请检查括号、引号和逗号");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("配置必须是 JSON 对象");
  const settings = { ...object(parsed) };
  if (
    settings.env !== undefined &&
    (!settings.env ||
      typeof settings.env !== "object" ||
      Array.isArray(settings.env))
  )
    throw new Error("env 必须是对象");
  const env = { ...object(settings.env) };
  if (
    Object.entries(env).some(
      ([key, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        typeof value !== "string" ||
        value.includes("\0"),
    )
  )
    throw new Error("环境变量名无效或值不是字符串");
  for (const key of [
    "skipWebFetchPreflight",
    "skipDangerousModePermissionPrompt",
    "alwaysThinkingEnabled",
  ]) {
    if (settings[key] !== undefined && typeof settings[key] !== "boolean")
      throw new Error(`${key} 必须为 true 或 false`);
  }
  if (settings.model !== undefined && typeof settings.model !== "string")
    throw new Error("model 必须为字符串");
  if (
    settings.enabledPlugins !== undefined &&
    (!settings.enabledPlugins ||
      typeof settings.enabledPlugins !== "object" ||
      Array.isArray(settings.enabledPlugins) ||
      Object.values(object(settings.enabledPlugins)).some(
        (value) => typeof value !== "boolean",
      ))
  )
    throw new Error("enabledPlugins 必须是插件名称与布尔值的映射");
  const token = env.ANTHROPIC_AUTH_TOKEN as string | undefined;
  const key = env.ANTHROPIC_API_KEY as string | undefined;
  if (token && key)
    throw new Error(
      "请只保留 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY 中的一种鉴权",
    );
  if (env.CLAUDE_CODE_OAUTH_TOKEN)
    throw new Error("OAuth 登录请使用 Claude Code 本地登录；此处导入 API 配置");
  const profile = { ...draft.profile, settings };
  if (typeof env.ANTHROPIC_BASE_URL === "string")
    profile.baseUrl = env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_BASE_URL;
  for (const [field, name] of modelFields) {
    profile[field] = typeof env[name] === "string" ? env[name] : "";
    delete env[name];
  }
  const authType = token ? "auth-token" : key ? "api-key" : profile.authType;
  profile.authType = authType;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  settings.env = env;
  if (!profile.name && profile.baseUrl) {
    try {
      profile.name = new URL(profile.baseUrl).hostname;
    } catch {
      /* Leave an invalid URL for the connection form to correct. */
    }
  }
  const serviceChanged =
    draft.profile.baseUrl.replace(/\/$/, "") !==
      profile.baseUrl.replace(/\/$/, "") || draft.profile.authType !== authType;
  return {
    ...draft,
    profile,
    apiKey: token || key || (serviceChanged ? "" : draft.apiKey),
  };
}
