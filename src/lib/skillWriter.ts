import type { Usage } from "./types";
export interface SkillWritingResult {
  content: string;
  source: string;
  usage: Usage;
  reference?: { name: string; url: string } | null;
}
export interface SkillWritingState {
  open?: boolean;
  instruction?: string;
  referenceUrl?: string;
  customReference?: boolean;
  busy?: boolean;
  editing?: boolean;
  error?: string;
  result?: SkillWritingResult | null;
}
export const skillReferences = [
  { value: "", label: "不使用参考" },
  {
    value:
      "https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md",
    label: "网页测试 · Anthropic",
  },
  {
    value:
      "https://github.com/openai/skills/blob/main/skills/.curated/gh-fix-ci/SKILL.md",
    label: "CI 故障排查 · OpenAI",
  },
];
