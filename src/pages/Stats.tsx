import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Choice,
  PageHeading,
  SectionHeading,
} from "@/components/workspace/shared";
import {
  usageRecords,
  groupBy,
  agentNames,
  compact,
  csv,
  projectName,
  tokens,
  type Snapshot,
} from "@/lib/types";
import { exportText } from "@/lib/api";
const tooltipStyle = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};
const tickStyle = { fill: "var(--muted-foreground)" };
export function StatsPage({
  snapshot,
  project,
}: {
  snapshot: Snapshot;
  project: string;
}) {
  const [period, setPeriod] = useState("7");
  const [asOf] = useState(() => Date.now());
  const tasks = useMemo(
    () =>
      usageRecords(snapshot.tasks).filter(
        (t) =>
          (project === "all" || project === t.project) &&
          (period === "all" ||
            new Date(t.updatedAt).getTime() > asOf - Number(period) * 86400000),
      ),
    [snapshot.tasks, project, period, asOf],
  );
  const total = tasks.reduce((s, t) => s + tokens(t), 0);
  const cached = tasks.reduce((s, t) => s + t.usage.cached, 0);
  const known = tasks.filter((t) => t.usage.known).length;
  const dayCount = period === "all" ? 30 : Number(period);
  const series = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(asOf);
    d.setDate(d.getDate() - (dayCount - 1 - i));
    const key = d.toLocaleDateString("sv");
    const items = tasks.filter(
      (t) => new Date(t.updatedAt).toLocaleDateString("sv") === key,
    );
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      input: items.reduce((s, t) => s + t.usage.input, 0),
      output: items.reduce((s, t) => s + t.usage.output, 0),
    };
  });
  const agentUsage = tasks.flatMap((t) =>
    Object.keys(t.usageByAgent || {}).length > 1
      ? Object.entries(t.usageByAgent!).map(([agentKind, usage]) => ({
          ...t,
          agentKind,
          usage,
        }))
      : [t],
  );
  const byAgent = [...groupBy(agentUsage, (t) => t.agentKind)]
    .map(([agent, items]) => ({
      agent: agentNames[agent] || agent,
      tokens: items.reduce((s, t) => s + tokens(t), 0),
      count: items.length,
    }))
    .sort((a, b) => b.tokens - a.tokens);
  const byProject = [...groupBy(tasks, (t) => t.project)]
    .map(([path, items]) => ({
      path,
      count: items.length,
      input: items.reduce((s, t) => s + t.usage.input, 0),
      output: items.reduce((s, t) => s + t.usage.output, 0),
      cached: items.reduce((s, t) => s + t.usage.cached, 0),
    }))
    .sort((a, b) => b.input + b.output - (a.input + a.output));
  return (
    <div className="mx-auto w-full max-w-7xl p-5 lg:p-8">
      <PageHeading title="用量统计">
        <Choice
          label="统计周期"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "7", label: "最近 7 天" },
            { value: "30", label: "最近 30 天" },
            { value: "all", label: "全部时间" },
          ]}
        />
        <Button
          variant="outline"
          onClick={() =>
            void exportText("oiagent-usage.csv", csv(tasks))
              .then((saved) => {
                if (saved) toast.success("已导出统计");
              })
              .catch((e) => toast.error(String(e)))
          }
        >
          <Download />
          导出
        </Button>
      </PageHeading>
      <div className="mb-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          ["任务与会话", tasks.length.toLocaleString()],
          ["Token 总量", compact(total)],
          ["缓存 Token", compact(cached)],
          [
            "已完成任务",
            tasks
              .filter((t) => t.status === "completed")
              .length.toLocaleString(),
          ],
        ].map(([label, value]) => (
          <Card key={label} className="gap-0 py-0 shadow-xs">
            <CardContent className="p-5">
              <p className="mb-3 text-xs text-muted-foreground">{label}</p>
              <p className="text-3xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mb-7 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="gap-0 py-0 shadow-xs">
          <CardContent className="p-5">
            <SectionHeading
              action={
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-chart-1" />
                    输入
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-chart-2" />
                    输出
                  </span>
                </div>
              }
            >
              Token 分布
            </SectionHeading>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={series}
                  margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    tick={tickStyle}
                    tickMargin={12}
                    minTickGap={30}
                  />
                  <YAxis
                    tickFormatter={compact}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    tick={tickStyle}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--popover-foreground)" }}
                    cursor={{
                      stroke: "var(--muted-foreground)",
                      strokeDasharray: "3 3",
                    }}
                    formatter={(value, name) => [
                      Number(value).toLocaleString(),
                      name === "input" ? "输入 Token" : "输出 Token",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="input"
                    stroke="var(--chart-1)"
                    fill="var(--chart-1)"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="output"
                    stroke="var(--chart-2)"
                    fill="var(--chart-2)"
                    fillOpacity={0.08}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              按会话最后活跃日汇总{period === "all" ? "，图表展示近 30 天" : ""}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0 shadow-xs">
          <CardContent className="p-5">
            <SectionHeading>Agent 用量</SectionHeading>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byAgent}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 12, bottom: 0 }}
                >
                  <XAxis
                    type="number"
                    tickFormatter={compact}
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                    tick={tickStyle}
                  />
                  <YAxis
                    type="category"
                    dataKey="agent"
                    width={90}
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                    tick={tickStyle}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "var(--popover-foreground)" }}
                    itemStyle={{ color: "var(--popover-foreground)" }}
                    cursor={{ fill: "var(--muted)" }}
                    formatter={(value) => [
                      Number(value).toLocaleString(),
                      "Token",
                    ]}
                  />
                  <Bar
                    dataKey="tokens"
                    fill="var(--chart-1)"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {known} / {tasks.length} 条记录包含用量信息
            </p>
          </CardContent>
        </Card>
      </div>
      <SectionHeading count={byProject.length}>项目用量</SectionHeading>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">项目</TableHead>
              <TableHead className="text-right">任务 / 会话</TableHead>
              <TableHead className="text-right">输入</TableHead>
              <TableHead className="text-right">输出</TableHead>
              <TableHead className="pr-5 text-right">缓存</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byProject.map((p) => (
              <TableRow key={p.path}>
                <TableCell className="max-w-64 py-4 pl-5">
                  <div className="font-medium">{projectName(p.path)}</div>
                  <div
                    className="mt-1 truncate text-xs text-muted-foreground"
                    title={p.path}
                  >
                    {p.path}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.count}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {compact(p.input)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {compact(p.output)}
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {compact(p.cached)}
                </TableCell>
              </TableRow>
            ))}
            {!byProject.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-muted-foreground"
                >
                  此时间范围内没有用量记录
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">
        只统计 Agent 实际上报的用量；缓存包含在输入 Token
        中。历史会话不推断完成状态，未上报用量的记录不计入 Token 总量。
      </p>
    </div>
  );
}
