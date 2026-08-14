import type {
  JsonValue,
  RuleStateEnvelope,
} from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { RULE_RUNTIME_LIMITS } from "./limits";

export interface RuleStateReferenceIndex {
  readonly voiceIds?: ReadonlySet<string>;
  readonly noteIds: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  readonly chordIds: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  readonly spanIds: ReadonlySet<string>;
}

export interface RuleStateValidationOptions {
  readonly ownerRuleId: string;
  readonly maximumTick: number;
  readonly maximumSliceIndex: number;
  readonly knownReferences: RuleStateReferenceIndex;
}

function isJsonValue(
  value: unknown,
  seen = new Set<object>(),
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  return Object.entries(value).every(
    ([, item]) => item !== undefined && isJsonValue(item, seen),
  );
}

function stringRefs(value: unknown, limit: number, label: string) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > limit ||
    value.some((item) => typeof item !== "string")
  )
    throw new Error(`规则状态 ${label} 无效`);
  return value as string[];
}

/**
 * 验证并深复制规则状态。调用者通过 maximumTick/maximumSliceIndex 表达当前
 * 执行位置，因此同步、异步和外置复核可以共享完全相同的状态契约。
 */
export function validateRuleStates(
  states: unknown,
  options: RuleStateValidationOptions,
): readonly RuleStateEnvelope[] {
  if (
    !Array.isArray(states) ||
    states.length > RULE_RUNTIME_LIMITS.ruleStates
  )
    throw new Error("规则状态数量超过限制");
  const ids = new Set<string>();
  const knownVoices =
    options.knownReferences.voiceIds ?? new Set<string>(VOICE_ORDER);
  return states.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("规则状态必须是对象");
    const state = candidate as Record<string, unknown>;
    if (
      typeof state.id !== "string" ||
      !state.id.trim() ||
      state.id.length > RULE_RUNTIME_LIMITS.ruleStateIdLength ||
      ids.has(state.id) ||
      state.ownerRuleId !== options.ownerRuleId
    )
      throw new Error("规则状态标识无效");
    ids.add(state.id);
    const createdAt = state.createdAt;
    if (
      !createdAt ||
      typeof createdAt !== "object" ||
      Array.isArray(createdAt) ||
      !Number.isInteger((createdAt as { tick?: unknown }).tick) ||
      !Number.isInteger((createdAt as { sliceIndex?: unknown }).sliceIndex)
    )
      throw new Error("规则状态创建位置无效");
    const tick = (createdAt as { tick: number }).tick;
    const sliceIndex = (createdAt as { sliceIndex: number }).sliceIndex;
    if (
      tick < 0 ||
      tick > options.maximumTick ||
      sliceIndex < 0 ||
      sliceIndex > options.maximumSliceIndex
    )
      throw new Error("规则状态创建位置无效");
    const subjectRefs = state.subjectRefs;
    if (
      subjectRefs !== undefined &&
      (!subjectRefs || typeof subjectRefs !== "object" || Array.isArray(subjectRefs))
    )
      throw new Error("规则状态引用无效");
    const refs = (subjectRefs ?? {}) as Record<string, unknown>;
    const voiceIds = stringRefs(
      refs.voiceIds,
      RULE_RUNTIME_LIMITS.subjectVoiceIds,
      "voiceIds",
    );
    const noteIds = stringRefs(
      refs.noteIds,
      RULE_RUNTIME_LIMITS.subjectNoteIds,
      "noteIds",
    );
    const chordIds = stringRefs(
      refs.chordIds,
      RULE_RUNTIME_LIMITS.subjectChordIds,
      "chordIds",
    );
    const spanIds = stringRefs(
      refs.spanIds,
      RULE_RUNTIME_LIMITS.subjectSpanIds,
      "spanIds",
    );
    if (
      voiceIds?.some((id) => !knownVoices.has(id)) ||
      noteIds?.some((id) => !options.knownReferences.noteIds.has(id)) ||
      chordIds?.some((id) => !options.knownReferences.chordIds.has(id)) ||
      spanIds?.some((id) => !options.knownReferences.spanIds.has(id))
    )
      throw new Error("规则状态引用了不存在的分析对象");
    if (!isJsonValue(state.payload))
      throw new Error("规则状态必须是纯 JSON 数据");
    const serialized = JSON.stringify(state.payload);
    if (
      new TextEncoder().encode(serialized).byteLength >
      RULE_RUNTIME_LIMITS.ruleStatePayloadBytes
    )
      throw new Error("单个规则状态超过 16 KiB 限制");
    return {
      id: state.id,
      ownerRuleId: options.ownerRuleId,
      createdAt: { tick, sliceIndex },
      subjectRefs:
        subjectRefs === undefined
          ? undefined
          : {
              voiceIds: voiceIds ? ([...voiceIds] as VoiceId[]) : undefined,
              noteIds: noteIds ? [...noteIds] : undefined,
              chordIds: chordIds ? [...chordIds] : undefined,
              spanIds: spanIds ? [...spanIds] : undefined,
            },
      payload: JSON.parse(serialized) as JsonValue,
    } satisfies RuleStateEnvelope;
  });
}
