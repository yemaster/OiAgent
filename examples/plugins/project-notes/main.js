let project = "general", settings = {};
oiagent.onOpen(async ({ viewId, settings: config, values }) => {
  if (viewId === "help") {
    oiagent.ui.render({ type: "stack", children: [
      { type: "text", text: "便笺按当前项目分别保存。点击保存便笺写入本机；填写任务会打开新建任务页，由你选择 Agent 和执行权限。" },
      { type: "button", text: "打开便笺", action: "open-notes" }
    ] });
    return;
  }
  settings = config;
  const context = await oiagent.workspace.getContext();
  project = context.project || "general";
  const storage = await oiagent.storage.get();
  const saved = storage[project] || {};
  oiagent.ui.render({ type: "stack", children: [
    { type: "text", text: context.project || "通用便笺" },
    { type: "input", id: "title", label: "标题", value: values.title ?? saved.title ?? "" },
    { type: "textarea", id: "notes", label: "内容", value: values.notes ?? saved.notes ?? "" },
    { type: "row", children: [
      { type: "button", text: "保存便笺", action: "save", variant: "default" },
      { type: "button", text: "填写任务", action: "draft" },
      { type: "button", text: "使用说明", action: "help" }
    ] }
  ] });
});
oiagent.onAction(async ({ action, values }) => {
  if (action === "help") return oiagent.views.open("help");
  if (action === "open-notes") return oiagent.views.open("notes");
  if (action === "save") {
    const storage = await oiagent.storage.get();
    storage[project] = { title: values.title || "", notes: values.notes || "" };
    await oiagent.storage.set(storage);
    return oiagent.notify("便笺已保存");
  }
  if (action === "draft") return oiagent.tasks.createDraft({
    title: `${settings["task-prefix"] || ""}${values.title || "项目便笺"}`,
    prompt: values.notes || ""
  });
});
