import { useEffect, useState } from "react";
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Choice, IconButton } from "./shared";
import { call, desktop } from "@/lib/api";
import {
  templateVariables,
  fillTemplate,
  insertTemplate,
  type TaskTemplate,
  type TemplateLibrary,
} from "@/lib/taskTemplates";
export function TaskTemplates({
  prompt,
  onChange,
}: {
  prompt: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<TemplateLibrary>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<TaskTemplate>();
  const [remove, setRemove] = useState<TaskTemplate>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [replace, setReplace] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void call<TemplateLibrary>("list_task_templates")
      .then((v) => {
        if (!cancelled) {
          setLibrary(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, reload]);
  const filtered = (library?.templates || []).filter(
    (t) =>
      (category === "all" || t.category === category) &&
      `${t.name} ${t.category} ${t.prompt}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const template = filtered.find((t) => t.id === selected) || filtered[0];
  const variables = templateVariables(template?.prompt || "");
  const preview = fillTemplate(template?.prompt || "", values);
  function edit(template?: TaskTemplate) {
    setEditing(
      template
        ? { ...template }
        : { id: "", name: "", category: "", prompt: "" },
    );
  }
  async function save() {
    if (!editing || !library) return;
    setBusy(true);
    try {
      const next = await call<TemplateLibrary>("save_task_template", {
        template: editing,
        expected: library.revision,
      });
      setLibrary(next);
      setSelected(editing.id || next.templates.at(-1)!.id);
      setQuery("");
      setCategory("all");
      setValues({});
      setEditing(undefined);
      toast.success("模板已保存");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          setOpen(true);
          setReplace(false);
          setValues({});
        }}
      >
        <FileText />
        任务模板
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v);
            if (!v) {
              setEditing(undefined);
              setError("");
            }
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? editing.id
                  ? "编辑任务模板"
                  : "新建任务模板"
                : "任务模板"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "写好可复用的 Prompt，用 {{变量名}} 标记每次需要填写的内容。"
                : desktop
                  ? "选择模板、填写变量，插入后仍可继续编辑。"
                  : "浏览器模板仅保存在当前浏览器，桌面版单独保存。"}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 text-sm text-destructive"
            >
              <span className="flex-1">{error}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setReload((n) => n + 1)}
              >
                <RefreshCw />
                刷新
              </Button>
            </div>
          )}
          {editing ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="template-name">模板名称</Label>
                  <Input
                    id="template-name"
                    maxLength={80}
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-category">分类（可选）</Label>
                  <Input
                    id="template-category"
                    maxLength={32}
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({ ...editing, category: e.target.value })
                    }
                  />
                </div>
              </div>
              <Label htmlFor="template-body">模板 Prompt</Label>
              <Textarea
                id="template-body"
                className="min-h-64 text-sm leading-6"
                value={editing.prompt}
                onChange={(e) =>
                  setEditing({ ...editing, prompt: e.target.value })
                }
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditing(undefined)}
                >
                  <ArrowLeft />
                  返回列表
                </Button>
                <Button
                  disabled={
                    busy || !editing.name.trim() || !editing.prompt.trim()
                  }
                  onClick={() => void save()}
                >
                  保存模板
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="搜索任务模板"
                  placeholder="搜索模板…"
                  className="min-w-32 flex-1"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setValues({});
                  }}
                />
                <Choice
                  label="模板分类"
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setValues({});
                  }}
                  options={[
                    { value: "all", label: "全部分类" },
                    ...[
                      ...new Set(
                        (library?.templates || [])
                          .map((t) => t.category)
                          .filter(Boolean),
                      ),
                    ].map((c) => ({ value: c, label: c })),
                  ]}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!library}
                  onClick={() => edit()}
                >
                  <Plus />
                  新建
                </Button>
                {prompt.trim() && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!library}
                    onClick={() =>
                      setEditing({ id: "", name: "", category: "", prompt })
                    }
                  >
                    保存当前内容
                  </Button>
                )}
              </div>
              <div className="grid min-h-64 gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
                <div className="max-h-80 space-y-1 overflow-auto sm:border-r sm:pr-3">
                  {filtered.map((t) => (
                    <Button
                      key={t.id}
                      variant="navigation"
                      data-active={template?.id === t.id}
                      aria-pressed={template?.id === t.id}
                      className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-left"
                      onClick={() => {
                        setSelected(t.id);
                        setValues({});
                      }}
                    >
                      <span>
                        <span className="block text-sm">{t.name}</span>
                        {t.category && (
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {t.category}
                          </span>
                        )}
                      </span>
                    </Button>
                  ))}
                  {!filtered.length && (
                    <p className="py-4 text-sm text-muted-foreground">
                      {library ? "没有匹配的模板" : "正在读取模板…"}
                    </p>
                  )}
                </div>
                {template && (
                  <div className="min-w-0 space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="flex-1 text-sm font-medium">
                        {template.name}
                      </h3>
                      <IconButton
                        label="编辑模板"
                        onClick={() => edit(template)}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label="删除模板"
                        onClick={() => setRemove(template)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                    {variables.map((key, index) => (
                      <div className="space-y-2" key={key}>
                        <Label htmlFor={`template-variable-${index}`}>
                          {key}
                        </Label>
                        <Input
                          id={`template-variable-${index}`}
                          value={
                            typeof values[key] === "string" ? values[key] : ""
                          }
                          onChange={(e) =>
                            setValues({ ...values, [key]: e.target.value })
                          }
                        />
                      </div>
                    ))}
                    <div
                      className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-6"
                      aria-label="模板预览"
                    >
                      {preview}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="items-center">
                {prompt.trim() && (
                  <Choice
                    label="模板插入方式"
                    value={replace ? "replace" : "append"}
                    onChange={(v) => setReplace(v === "replace")}
                    options={[
                      { value: "append", label: "追加到当前内容" },
                      { value: "replace", label: "替换当前内容" },
                    ]}
                  />
                )}
                <Button
                  disabled={
                    !template ||
                    variables.some(
                      (v) => typeof values[v] !== "string" || !values[v].trim(),
                    )
                  }
                  onClick={() => {
                    onChange(insertTemplate(prompt, preview, replace));
                    setOpen(false);
                  }}
                >
                  {replace ? "替换内容" : "插入模板"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(v) => {
          if (!v) setRemove(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{remove?.name}」？</DialogTitle>
            <DialogDescription>已插入任务的内容不会受影响。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!library || !remove) return;
                setBusy(true);
                try {
                  setLibrary(
                    await call<TemplateLibrary>("remove_task_template", {
                      id: remove.id,
                      expected: library.revision,
                    }),
                  );
                  setRemove(undefined);
                  setValues({});
                } catch (e) {
                  toast.error(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
