import { expect, it } from "vitest";
import { subagentDescription } from "@/lib/subagentDescription";
import { demoSnapshot } from "@/lib/demo";

const describe = (preview: string, prompt = "检查文件并汇总结果") =>
  subagentDescription({ ...demoSnapshot.tasks[0], preview, prompt });

it("shows the rationale from real approval-result shapes instead of JSON metadata", () => {
  expect(
    describe(
      JSON.stringify({
        risk_level: "low",
        user_authorization: "explicit",
        outcome: "allow",
        rationale: "该操作仅检查项目文件。",
      }),
    ),
  ).toBe("该操作仅检查项目文件。");
  expect(
    describe(
      JSON.stringify({
        findings: [],
        overall_correctness: "patch is correct",
        overall_explanation: "修复已覆盖原有问题。",
      }),
    ),
  ).toBe("修复已覆盖原有问题。");
});

it("unwraps fenced, nested and encoded message contents without displaying tool or binary blocks", () => {
  expect(describe('```json\n{"summary":"检查完成"}\n```')).toBe("检查完成");
  expect(
    describe(
      JSON.stringify({
        message: {
          content: [
            { type: "text", text: "第一项检查通过" },
            { type: "tool_use", name: "Bash", input: { command: "ignored" } },
            { type: "image", data: "base64" },
            { type: "output_text", text: "第二项检查通过" },
          ],
        },
      }),
    ),
  ).toBe("第一项检查通过\n第二项检查通过");
  expect(
    describe(
      JSON.stringify(JSON.stringify({ result: { summary: "嵌套结果" } })),
    ),
  ).toBe("嵌套结果");
  expect(describe('{"data":"base64","request_id":"metadata"}')).toBe(
    "检查文件并汇总结果",
  );
});

it("falls back for truncated, unknown and oversized JSON while preserving normal prose", () => {
  expect(describe('{"risk_level":"low","rationale":"unfinished')).toBe(
    "检查文件并汇总结果",
  );
  expect(describe('{"status":"ok","tokens":100}')).toBe("检查文件并汇总结果");
  expect(describe(JSON.stringify({ summary: "x".repeat(70_000) }))).toBe(
    "检查文件并汇总结果",
  );
  for (const text of [
    "普通简介",
    "[完成] 已检查",
    '"通过"是测试结果',
    "请检查 {name} 参数",
    '返回 JSON，例如 {"ok":true}',
  ])
    expect(describe(text)).toBe(text);
  expect(
    describe(
      "",
      "<environment_context>metadata</environment_context>\n真正的分工说明",
    ),
  ).toBe("真正的分工说明");
  expect(
    describe('{"request_id":"internal"}', '{"type":"image","data":"hidden"}'),
  ).toBe("");
});

it("keeps stored messages intact and refreshes the description with a new task snapshot", () => {
  const task = Object.freeze({
    ...demoSnapshot.tasks[0],
    preview: '{"summary":"首次结果"}',
    prompt: "分工说明",
  });
  expect(subagentDescription(task)).toBe("首次结果");
  expect(task.preview).toBe('{"summary":"首次结果"}');
  expect(
    subagentDescription({ ...task, preview: '{"summary":"新的结果"}' }),
  ).toBe("新的结果");
});
