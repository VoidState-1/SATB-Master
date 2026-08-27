import type { ProjectDocument } from "../domain/project";

export type SoundFontReference = ProjectDocument["audio"]["soundFont"];

/** 标识实际音源；显示名称变化不应触发同一资源重新加载。 */
export function soundFontId(soundFont: SoundFontReference) {
  return soundFont.kind === "default"
    ? "default"
    : `user:${soundFont.hash ?? soundFont.path ?? soundFont.name}`;
}

/** 标识加载位置；同一内容移动后可在尚未加载时从新路径重试。 */
export function soundFontLoadKey(soundFont: SoundFontReference) {
  if (soundFont.kind === "default") return "default";
  return JSON.stringify([
    soundFont.hash ?? null,
    soundFont.path ?? null,
    soundFont.hash || soundFont.path ? null : soundFont.name,
  ]);
}
