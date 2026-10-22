import { useMemo, useSyncExternalStore } from "react";

export type ShortcutPlatform = "windows" | "linux" | "macos";
export function shortcutPlatform(): ShortcutPlatform {
  const platform = navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(platform)
    ? "macos"
    : /Win32|Win64|Windows|WinCE/i.test(platform)
      ? "windows"
      : "linux";
}
export const shortcutGroups = [
  { id: "conversation", label: "对话与任务" },
  { id: "workspace", label: "工作区" },
  { id: "tabs", label: "标签页" },
  { id: "window", label: "窗口" },
] as const;
export const shortcutDefinitions = [
  {
    id: "send",
    group: "conversation",
    label: "发送消息 / 启动任务",
    default: "Mod+Enter",
  },
  {
    id: "newline",
    group: "conversation",
    label: "对话框中换行",
    default: "Shift+Enter",
  },
  {
    id: "new-task",
    group: "conversation",
    label: "新建任务",
    default: "Mod+N",
  },
  {
    id: "add-project",
    group: "workspace",
    label: "打开项目",
    default: "Mod+O",
  },
  { id: "search", group: "workspace", label: "搜索任务", default: "Mod+K" },
  {
    id: "find-conversation",
    group: "conversation",
    label: "搜索当前对话",
    default: "Mod+F",
  },
  {
    id: "toggle-project-terminal",
    group: "workspace",
    label: "显示 / 隐藏项目终端",
    default: "Ctrl+`",
  },
  { id: "save-file", group: "workspace", label: "保存文件", default: "Mod+S" },
  { id: "close-tab", group: "tabs", label: "关闭标签", default: "Mod+W" },
  {
    id: "toggle-sidebar",
    group: "workspace",
    label: "显示 / 隐藏侧栏",
    default: "Mod+B",
  },
  {
    id: "back",
    group: "workspace",
    label: "返回上一页",
    default: "Alt+ArrowLeft",
  },
  {
    id: "move-tab-left",
    group: "tabs",
    label: "向左移动标签",
    default: "Alt+Shift+ArrowLeft",
  },
  {
    id: "move-tab-right",
    group: "tabs",
    label: "向右移动标签",
    default: "Alt+Shift+ArrowRight",
  },
  { id: "settings", group: "workspace", label: "打开设置", default: "Mod+," },
  { id: "minimize", group: "window", label: "最小化窗口", default: "Mod+M" },
  { id: "fullscreen", group: "window", label: "切换全屏", default: "F11" },
  { id: "quit", group: "window", label: "退出应用", default: "Mod+Q" },
] as const;
export type ShortcutId = (typeof shortcutDefinitions)[number]["id"];
export type Shortcuts = Record<ShortcutId, string>;
export type SendShortcut = string;
const storageKey = "oiagent-shortcuts";
const legacyKey = "oiagent-send-shortcut";
const changeEvent = "oiagent-shortcuts-changed";
const defaults = Object.fromEntries(
  shortcutDefinitions.map((s) => [s.id, s.default]),
) as Shortcuts;
const legacy: Record<string, string> = {
  "mod-enter": "Mod+Enter",
  enter: "Enter",
  "alt-enter": "Alt+Enter",
};
export const sendShortcuts = Object.entries(legacy).map(([value, chord]) => ({
  value,
  label: shortcutLabel(chord),
}));
function platformDefaults(platform: ShortcutPlatform): Shortcuts {
  return {
    ...defaults,
    ...(platform === "macos"
      ? { back: "Mod+[", fullscreen: "Ctrl+Meta+F" }
      : {}),
  };
}
function snapshot(platform = shortcutPlatform()) {
  try {
    return (
      localStorage.getItem(`${storageKey}-${platform}`) ??
      (platform === shortcutPlatform()
        ? localStorage.getItem(storageKey)
        : null) ??
      JSON.stringify({
        send:
          platform === shortcutPlatform()
            ? (legacy[localStorage.getItem(legacyKey) ?? ""] ?? defaults.send)
            : defaults.send,
      })
    );
  } catch {
    return "{}";
  }
}
function parse(raw: string, platform = shortcutPlatform()): Shortcuts {
  const base = platformDefaults(platform);
  try {
    const saved = JSON.parse(raw);
    return Object.fromEntries(
      shortcutDefinitions.map((s) => [
        s.id,
        typeof saved?.[s.id] === "string" && saved[s.id]
          ? saved[s.id]
          : base[s.id],
      ]),
    ) as Shortcuts;
  } catch {
    return base;
  }
}
// Migrate the shared configuration once to the current OS only. Explicit
// defaults for the other OSes prevent old bindings leaking into their profiles.
function migrate() {
  if (!localStorage.getItem(storageKey) && !localStorage.getItem(legacyKey))
    return;
  const current = shortcutPlatform();
  for (const platform of ["windows", "linux", "macos"] as const) {
    const key = `${storageKey}-${platform}`;
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify(
          platform === current
            ? parse(snapshot(), current)
            : platformDefaults(platform),
        ),
      );
  }
  localStorage.removeItem(storageKey);
  localStorage.removeItem(legacyKey);
}
function subscribe(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useShortcuts(platform = shortcutPlatform()) {
  const raw = useSyncExternalStore(
    subscribe,
    () => snapshot(platform),
    () => "{}",
  );
  return useMemo(() => parse(raw, platform), [raw, platform]);
}
export function setShortcut(
  id: ShortcutId,
  value: string,
  platform = shortcutPlatform(),
) {
  migrate();
  localStorage.setItem(
    `${storageKey}-${platform}`,
    JSON.stringify({
      ...parse(snapshot(platform), platform),
      [id]: legacy[value] ?? value,
    }),
  );
  window.dispatchEvent(new Event(changeEvent));
}
export function resetShortcuts(platform = shortcutPlatform()) {
  migrate();
  localStorage.setItem(
    `${storageKey}-${platform}`,
    JSON.stringify(platformDefaults(platform)),
  );
  window.dispatchEvent(new Event(changeEvent));
}
export function useSendShortcut() {
  const value = useShortcuts().send;
  return Object.keys(legacy).find((key) => legacy[key] === value) ?? value;
}
export function setSendShortcut(value: SendShortcut) {
  setShortcut("send", value);
}
export function shortcutLabel(
  value: string,
  platform = shortcutPlatform(),
): string {
  return (legacy?.[value] ?? value)
    .split("+")
    .map(
      (key) =>
        ({
          Mod: platform === "macos" ? "⌘" : "Ctrl",
          Meta:
            platform === "macos"
              ? "⌘"
              : platform === "windows"
                ? "Win"
                : "Super",
          Alt: platform === "macos" ? "Option" : "Alt",
          ArrowLeft: "←",
          ArrowRight: "→",
          ArrowUp: "↑",
          ArrowDown: "↓",
          Space: "Space",
          Plus: "+",
        })[key] ?? key,
    )
    .join(" + ");
}
export const sendShortcutLabel = shortcutLabel;
type KeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat"
> & { isComposing?: boolean; keyCode?: number; code?: string };
function keyName(e: KeyEvent) {
  // Option and Shift can change event.key; native menu accelerators use the key itself.
  if (e.code && /^(Key[A-Z]|Digit[0-9])$/.test(e.code))
    return e.code.replace(/^(Key|Digit)/, "");
  const punctuation: Record<string, string> = {
    Equal: "=",
    Minus: "-",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
  };
  if (e.code && punctuation[e.code]) return punctuation[e.code];
  if (e.key === " ") return "Space";
  if (e.key === "+") return "=";
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}
export function captureShortcut(e: KeyEvent): string | null {
  if (
    e.repeat ||
    e.isComposing ||
    e.keyCode === 229 ||
    [
      "Control",
      "Meta",
      "Alt",
      "Shift",
      "Dead",
      "Unidentified",
      "Process",
    ].includes(e.key)
  )
    return null;
  const key = keyName(e);
  if (
    !/^(?:[A-Z0-9,.;'`/\\[\]=-]|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Left|Right|Up|Down)|Escape|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(
      key,
    )
  )
    return null;
  return [
    e.ctrlKey && "Ctrl",
    e.metaKey && "Meta",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    keyName(e),
  ]
    .filter(Boolean)
    .join("+");
}
export function matchesShortcut(
  e: KeyEvent,
  value: string,
  platform = shortcutPlatform(),
) {
  if (e.repeat || e.isComposing || e.keyCode === 229) return false;
  const keys = (legacy[value] ?? value).split("+");
  const mod = keys.includes("Mod");
  return (
    keyName(e) === keys.at(-1) &&
    e.altKey === keys.includes("Alt") &&
    e.shiftKey === keys.includes("Shift") &&
    (mod
      ? platform === "macos"
        ? e.metaKey && !e.ctrlKey
        : e.ctrlKey && !e.metaKey
      : e.ctrlKey === keys.includes("Ctrl") &&
        e.metaKey === keys.includes("Meta"))
  );
}
export const matchesSendShortcut = matchesShortcut;
export function shortcutsConflict(a: string, b: string, mac?: boolean) {
  const expand = (s: string) => {
    const values =
      mac === undefined ? ["Ctrl", "Meta"] : [mac ? "Meta" : "Ctrl"];
    return values.map((mod) =>
      (legacy[s] ?? s).replace("Mod", mod).split("+").sort().join("+"),
    );
  };
  return expand(a).some((key) => expand(b).includes(key));
}
export function nativeShortcuts(
  shortcuts: Shortcuts,
  composerFocused: boolean,
  tabsFocused = false,
) {
  const assigned: string[] = [];
  const mac = shortcutPlatform() === "macos";
  return Object.fromEntries(
    shortcutDefinitions
      .filter(
        (s) =>
          ![
            "send",
            "newline",
            "move-tab-left",
            "move-tab-right",
            "find-conversation",
          ].includes(s.id),
      )
      .map(({ id }) => {
        const value = shortcuts[id];
        const blocked =
          assigned.some((chord) => shortcutsConflict(chord, value, mac)) ||
          (tabsFocused &&
            [shortcuts["move-tab-left"], shortcuts["move-tab-right"]].some(
              (chord) => shortcutsConflict(chord, value, mac),
            )) ||
          (composerFocused &&
            [shortcuts.send, shortcuts.newline].some((chord) =>
              shortcutsConflict(chord, value, mac),
            ));
        assigned.push(value);
        return [
          id,
          blocked
            ? ""
            : value
                .replace("Mod", "CmdOrCtrl")
                .replace("Meta", "Super")
                .replace(/Arrow/g, "")
                .replace("`", "Backquote"),
        ];
      }),
  );
}
export function insertNewline(
  input: HTMLTextAreaElement,
  onChange: (value: string) => void,
) {
  const start = input.selectionStart;
  onChange(
    input.value.slice(0, start) + "\n" + input.value.slice(input.selectionEnd),
  );
  requestAnimationFrame(() => {
    if (input.isConnected) input.setSelectionRange(start + 1, start + 1);
  });
}
