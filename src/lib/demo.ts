import { agentCatalog } from "./agents";
import type { Snapshot, Task, Detail } from "./types";
const stamp = (hours: number) =>
  new Date(Date.now() - hours * 3600000).toISOString();
const projects = [
  "/Users/demo/Projects/oiagent",
  "/Users/demo/Projects/atlas-web",
  "/Users/demo/Projects/design-system",
];
const records = [
  [
    "完善任务详情的对话体验",
    0,
    "claude",
    "running",
    "正在为消息列表添加 Markdown 渲染，并检查流式输出时的滚动行为。",
    0.1,
    28400,
  ],
  [
    "检查 API 错误处理与重试逻辑",
    1,
    "codex",
    "waiting",
    "已完成接口检查。需要确认是否为重试操作增加指数退避。",
    0.3,
    16200,
  ],
  [
    "补充组件的键盘交互测试",
    2,
    "qwen",
    "running",
    "已覆盖 Dialog 和 Select，正在检查焦点返回行为。",
    0.5,
    8900,
  ],
  ["整理项目启动与打包文档", 0, "codex", "queued", "等待启动", 1, 0],
  [
    "实现项目目录筛选",
    0,
    "claude",
    "completed",
    "项目筛选与搜索已接入，空状态和路径提示已验证。",
    2,
    32100,
  ],
  [
    "修复移动端导航溢出",
    1,
    "codex",
    "completed",
    "已调整侧边栏折叠行为，窄屏下导航可以正常访问。",
    4,
    24500,
  ],
  [
    "统一按钮与输入框的交互状态",
    2,
    "qwen",
    "completed",
    "完成组件状态整理。",
    20,
    18700,
  ],
  [
    "添加用量统计导出",
    0,
    "claude",
    "completed",
    "CSV 导出包含输入、输出和缓存 Token。",
    25,
    42200,
  ],
  [
    "讨论工作区的信息架构",
    0,
    "codex",
    "imported",
    "将任务概览和项目历史分开组织。",
    45,
    19300,
  ],
  [
    "优化列表加载速度",
    1,
    "qwen",
    "completed",
    "缓存索引减少重复解析开销。",
    68,
    14900,
  ],
  [
    "排查开发环境连接失败",
    1,
    "claude",
    "failed",
    "连接失败：服务未在指定端口监听。",
    72,
    5700,
  ],
  [
    "构建基础组件库",
    2,
    "codex",
    "completed",
    "基础组件与设计 token 已同步。",
    110,
    33500,
  ],
] as const;
export const demoSnapshot: Snapshot = {
  agents: Object.entries(agentCatalog).map(([id, info], i) => ({
    id,
    name: info.name,
    kind: id,
    executable: `/usr/local/bin/${id}`,
    args: [],
    available: i < 3,
    version: "示例程序",
    custom: false,
  })),
  projects,
  dataDir: "浏览器演示 · 不连接本机",
  warnings: [],
  tasks: records.map(
    (r, i) =>
      ({
        id: `demo-${i}`,
        title: r[0],
        prompt: `请${r[0]}，完成后说明改动和验证结果。`,
        project: projects[r[1]],
        agentId: r[2],
        agentKind: r[2],
        status: r[3],
        createdAt: stamp(r[5] + 0.5),
        updatedAt: stamp(r[5]),
        preview: r[4],
        usage: {
          input: Math.floor(r[6] * 0.8),
          output: Math.floor(r[6] * 0.2),
          cached: Math.floor(r[6] * 0.4),
          known: r[6] > 0,
        },
        sessionId: `sample-${i}`,
        source: r[3] === "imported" ? "history" : "managed",
        model: "默认模型",
        permission: "read-only",
        exitCode: r[3] === "completed" ? 0 : null,
        archived: false,
      }) satisfies Task,
  ),
};
demoSnapshot.tasks.push({
  ...demoSnapshot.tasks[0],
  id: "demo-child",
  title: "检查消息列表的滚动行为",
  prompt: "检查消息列表和流式输出时的滚动行为。",
  status: "completed",
  parentId: "demo-0",
  subagentId: "demo-reviewer",
  subagentName: "代码检查",
  source: "subagent",
  sessionId: "sample-child",
  preview: "发现一处滚动边界问题，已提供修复建议。",
  usage: { input: 3400, output: 800, cached: 1200, known: true },
  model: "示例模型",
});
export function demoDetail(task: Task): Detail {
  return {
    task,
    log: "演示记录，不对应真实进程。",
    messages: [
      { role: "user", text: task.prompt, timestamp: task.createdAt },
      {
        role: "assistant",
        text: "我会先检查现有实现和相关测试，确认需要调整的部分。",
        timestamp: task.createdAt,
      },
      {
        role: "tool",
        text: "Read",
        timestamp: task.createdAt,
        tool: {
          callId: "read-1",
          name: "Read",
          input: {
            file_path: "src/components/MessageList.tsx",
            offset: 1,
            limit: 120,
          },
          output:
            "export function MessageList() {\n  return <div ref={scrollRef}>…</div>\n}",
          state: "completed",
        },
      },
      {
        role: "tool",
        text: "Bash",
        timestamp: task.createdAt,
        tool: {
          callId: "test-1",
          name: "Bash",
          input: { command: "npm run test", workdir: task.project },
          output: [
            {
              type: "text",
              text: '{"exit_code":0,"output":"14 tests passed"}',
            },
          ],
          state: "completed",
        },
      },
      ...(task.id === "demo-0"
        ? [
            {
              role: "tool",
              text: "Agent",
              timestamp: task.createdAt,
              tool: {
                callId: "delegate-1",
                name: "Agent",
                input: {
                  description: "检查滚动与焦点",
                  subagent_type: "代码检查",
                  prompt: "检查消息列表滚动的边界条件",
                },
                output: "检查完成，发现一处滚动边界问题。",
                state: "completed" as const,
                childIds: ["demo-reviewer"],
              },
            },
          ]
        : []),
      {
        role: "assistant",
        text: `${task.preview}\n\n### 当前进展\n\n- 已检查现有代码结构\n- 已确认涉及的组件和数据接口\n- 正在验证关键交互\n\n~~~typescript\nconst tasks = await workspace.getTasks()\nconst active = tasks.filter(task => task.status === 'running')\n~~~`,
        timestamp: task.updatedAt,
      },
    ],
  };
}
