import { isMacOS } from "./keyboardPlatform";

export type ShortcutCommandId =
  | "newProject"
  | "openProject"
  | "saveProject"
  | "saveProjectAs"
  | "undo"
  | "redo"
  | "selectAll"
  | "clearSelection"
  | "copySelection"
  | "cutSelection"
  | "pasteSelection"
  | "duplicateSelection"
  | "deleteSelection"
  | "quantizeSelection"
  | "moveSelectionLeft"
  | "moveSelectionRight"
  | "pitchUp"
  | "pitchDown"
  | "octaveUp"
  | "octaveDown"
  | "selectTool"
  | "pencilTool"
  | "eraserTool"
  | "splitTool"
  | "autoBrushTool"
  | "nextVoice"
  | "previousVoice"
  | "playPause"
  | "goToStart"
  | "goToEnd"
  | "previousMeasure"
  | "nextMeasure"
  | "gridCoarser"
  | "gridFiner"
  | "zoomOut"
  | "zoomIn"
  | "runRuleTest"
  | "cancelOrClear";

export type ShortcutGroupId =
  "project" | "edit" | "transform" | "tools" | "transport" | "view";

export interface ShortcutDefinition {
  id: ShortcutCommandId;
  label: string;
  group: ShortcutGroupId;
  defaultBindings: string[];
  macDefaultBindings?: string[];
  allowRepeat?: boolean;
}

export type ShortcutBindings = Record<ShortcutCommandId, string[]>;

export const SHORTCUT_GROUPS: Array<{ id: ShortcutGroupId; label: string }> = [
  { id: "project", label: "工程与历史" },
  { id: "edit", label: "选择与剪贴板" },
  { id: "transform", label: "移动与变换" },
  { id: "tools", label: "工具与声部" },
  { id: "transport", label: "播放与定位" },
  { id: "view", label: "视图与网格" },
];

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "newProject",
    label: "新建工程",
    group: "project",
    defaultBindings: ["Ctrl+KeyN"],
  },
  {
    id: "openProject",
    label: "打开工程",
    group: "project",
    defaultBindings: ["Ctrl+KeyO"],
  },
  {
    id: "saveProject",
    label: "保存工程",
    group: "project",
    defaultBindings: ["Ctrl+KeyS"],
  },
  {
    id: "saveProjectAs",
    label: "工程另存为",
    group: "project",
    defaultBindings: ["Ctrl+Shift+KeyS"],
  },
  {
    id: "runRuleTest",
    label: "运行当前规则用例",
    group: "project",
    defaultBindings: ["F5"],
  },
  {
    id: "undo",
    label: "撤销",
    group: "project",
    defaultBindings: ["Ctrl+KeyZ"],
    allowRepeat: true,
  },
  {
    id: "redo",
    label: "重做",
    group: "project",
    defaultBindings: ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
    macDefaultBindings: ["Ctrl+Shift+KeyZ"],
    allowRepeat: true,
  },

  {
    id: "selectAll",
    label: "全选当前编辑域",
    group: "edit",
    defaultBindings: ["Ctrl+KeyA"],
  },
  {
    id: "clearSelection",
    label: "清除选择",
    group: "edit",
    defaultBindings: ["Ctrl+Shift+KeyA"],
  },
  {
    id: "copySelection",
    label: "复制所选事件",
    group: "edit",
    defaultBindings: ["Ctrl+KeyC"],
  },
  {
    id: "cutSelection",
    label: "剪切所选事件",
    group: "edit",
    defaultBindings: ["Ctrl+KeyX"],
  },
  {
    id: "pasteSelection",
    label: "粘贴事件",
    group: "edit",
    defaultBindings: ["Ctrl+KeyV"],
  },
  {
    id: "duplicateSelection",
    label: "重复所选事件",
    group: "edit",
    defaultBindings: ["Ctrl+KeyD"],
  },
  {
    id: "deleteSelection",
    label: "删除所选事件",
    group: "edit",
    defaultBindings: ["Delete", "Backspace"],
  },
  {
    id: "cancelOrClear",
    label: "取消当前操作 / 清除选择",
    group: "edit",
    defaultBindings: ["Escape"],
  },

  {
    id: "quantizeSelection",
    label: "量化选择起点",
    group: "transform",
    defaultBindings: ["KeyQ"],
  },
  {
    id: "moveSelectionLeft",
    label: "选择向前移动一个网格",
    group: "transform",
    defaultBindings: ["ArrowLeft"],
    allowRepeat: true,
  },
  {
    id: "moveSelectionRight",
    label: "选择向后移动一个网格",
    group: "transform",
    defaultBindings: ["ArrowRight"],
    allowRepeat: true,
  },
  {
    id: "pitchUp",
    label: "音符升高一个半音",
    group: "transform",
    defaultBindings: ["ArrowUp"],
    allowRepeat: true,
  },
  {
    id: "pitchDown",
    label: "音符降低一个半音",
    group: "transform",
    defaultBindings: ["ArrowDown"],
    allowRepeat: true,
  },
  {
    id: "octaveUp",
    label: "音符升高一个八度",
    group: "transform",
    defaultBindings: ["Shift+ArrowUp"],
    allowRepeat: true,
  },
  {
    id: "octaveDown",
    label: "音符降低一个八度",
    group: "transform",
    defaultBindings: ["Shift+ArrowDown"],
    allowRepeat: true,
  },

  {
    id: "selectTool",
    label: "选择工具",
    group: "tools",
    defaultBindings: ["Digit1"],
  },
  {
    id: "pencilTool",
    label: "铅笔工具",
    group: "tools",
    defaultBindings: ["Digit2"],
  },
  {
    id: "eraserTool",
    label: "擦除工具",
    group: "tools",
    defaultBindings: ["Digit3"],
  },
  {
    id: "splitTool",
    label: "切分工具",
    group: "tools",
    defaultBindings: ["Digit4"],
  },
  {
    id: "autoBrushTool",
    label: "自动笔刷",
    group: "tools",
    defaultBindings: ["Digit5"],
  },
  {
    id: "nextVoice",
    label: "切换到下一声部",
    group: "tools",
    defaultBindings: ["Tab"],
  },
  {
    id: "previousVoice",
    label: "切换到上一声部",
    group: "tools",
    defaultBindings: ["Shift+Tab"],
  },

  {
    id: "playPause",
    label: "播放 / 暂停",
    group: "transport",
    defaultBindings: ["Space"],
  },
  {
    id: "goToStart",
    label: "播放头回到开头",
    group: "transport",
    defaultBindings: ["Home"],
  },
  {
    id: "goToEnd",
    label: "播放头移到工程末尾",
    group: "transport",
    defaultBindings: ["End"],
  },
  {
    id: "previousMeasure",
    label: "播放头移到上一小节",
    group: "transport",
    defaultBindings: ["PageUp"],
    allowRepeat: true,
  },
  {
    id: "nextMeasure",
    label: "播放头移到下一小节",
    group: "transport",
    defaultBindings: ["PageDown"],
    allowRepeat: true,
  },

  {
    id: "gridCoarser",
    label: "使用更粗的吸附网格",
    group: "view",
    defaultBindings: ["BracketLeft"],
    allowRepeat: true,
  },
  {
    id: "gridFiner",
    label: "使用更细的吸附网格",
    group: "view",
    defaultBindings: ["BracketRight"],
    allowRepeat: true,
  },
  {
    id: "zoomOut",
    label: "缩小时间轴",
    group: "view",
    defaultBindings: ["Ctrl+Minus"],
    allowRepeat: true,
  },
  {
    id: "zoomIn",
    label: "放大时间轴",
    group: "view",
    defaultBindings: ["Ctrl+Equal"],
    allowRepeat: true,
  },
];

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

const CODE_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Delete: "Delete",
  End: "End",
  Equal: "=",
  Escape: "Esc",
  Home: "Home",
  Minus: "-",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Space: "Space",
  Tab: "Tab",
};

const MAC_NAVIGATION_KEYS = new Set(["Delete", "Home", "End", "PageUp", "PageDown"]);
const MAC_KEY_LABELS: Record<string, string> = {
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↩",
  Tab: "⇥",
};
const MAC_MODIFIER_LABELS: Record<string, string> = {
  Ctrl: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

interface KeyboardBindingSource {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

function fallbackCodeFromKey(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  const named: Record<string, string> = { " ": "Space", Esc: "Escape" };
  return named[key] ?? key;
}

export function keyboardEventToBinding(event: KeyboardBindingSource, mac = isMacOS) {
  const code = mac && MAC_NAVIGATION_KEYS.has(event.key)
    ? event.key // Fn on a Mac keyboard may change key without changing the physical code.
    : event.code && event.code !== "Unidentified"
      ? event.code
      : fallbackCodeFromKey(event.key);
  if (!code || MODIFIER_CODES.has(code)) return undefined;
  const parts: string[] = [];
  // The v1 storage token Ctrl represents the platform's primary modifier.
  if (event.metaKey || (!mac && event.ctrlKey)) parts.push("Ctrl");
  if (mac && event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(code);
  return parts.join("+");
}

export function defaultBindingsFor(definition: ShortcutDefinition, mac = isMacOS) {
  return mac && definition.macDefaultBindings
    ? definition.macDefaultBindings
    : definition.defaultBindings;
}

export function sameShortcutBindings(left: string[], right: string[]) {
  return left.length === right.length && left.every((binding, index) => binding === right[index]);
}

export function defaultShortcutBindings(mac = isMacOS): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [
      definition.id,
      [...defaultBindingsFor(definition, mac)],
    ]),
  ) as ShortcutBindings;
}

export function commandForKeyboardEvent(
  event: KeyboardBindingSource,
  bindings: ShortcutBindings,
  options: { ignoreControl?: boolean; mac?: boolean } = {},
) {
  const binding = keyboardEventToBinding(
    options.ignoreControl
      ? {
          code: event.code,
          key: event.key,
          ctrlKey: false,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
        }
      : event,
    options.mac,
  );
  if (!binding) return undefined;
  return SHORTCUT_DEFINITIONS.find((definition) =>
    bindings[definition.id].includes(binding),
  );
}

export function formatShortcutBinding(binding: string, mac = isMacOS) {
  const parts = binding.split("+");
  const code = parts.pop() ?? "";
  const codeLabel =
    (mac ? MAC_KEY_LABELS[code] : undefined) ??
    CODE_LABELS[code] ??
    (/^Key[A-Z]$/.test(code)
      ? code.slice(3)
      : /^Digit[0-9]$/.test(code)
        ? code.slice(5)
        : code.replace(/^Numpad/, "Num "));
  if (mac) return parts.map((part) => MAC_MODIFIER_LABELS[part] ?? part).join("") + codeLabel;
  return [...parts, codeLabel].join("+");
}

export function shortcutDefinition(commandId: ShortcutCommandId) {
  return SHORTCUT_DEFINITIONS.find((definition) => definition.id === commandId);
}
