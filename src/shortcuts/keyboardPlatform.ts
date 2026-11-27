export const usesNativeMacWindow =
  typeof window !== "undefined" && window.desktop?.platform === "darwin";

export const isMacOS = usesNativeMacWindow ||
  (typeof navigator !== "undefined" && /^Mac/.test(navigator.platform));

export function hasPrimaryModifier(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS ? event.metaKey : event.ctrlKey || event.metaKey;
}

export function isTextInput(target: Element | null) {
  return Boolean(target?.closest(
    'textarea, input:is(:not([type]), [type="text"], [type="search"], [type="number"], [type="password"], [type="email"], [type="tel"], [type="url"]), [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  ));
}
