import {
  chordStructureQuality,
  chordIdentityToneSpellings,
  type HarmonyInterpretation,
} from "../../../chordModel";
import { effectiveFunctionalDesignation } from "../../../functionalHarmonyCatalog";
import type {
  AnalysisChord,
  AnalysisKey,
  AnalysisNote,
  AnalysisSlice,
  HarmonySpan,
} from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import {
  isWrittenStep,
  pitchClassEquals,
  scaleDegreePitchClass,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordInversion,
  chordLabel,
  diagnostic,
} from "../helpers/core";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import type { ConnectionView } from "../context/views";
import { defineRuleGroup, defineStatelessRule } from "../defineRule";

type SpecializedRuleId =
  | "connection.dominant-seventh"
  | "connection.dominant-ninth"
  | "connection.leading-tone-seventh"
  | "connection.supertonic-seventh"
  | "connection.subdominant-seventh"
  | "connection.double-dominant-seventh"
  | "connection.double-dominant-leading-tone"
  | "connection.neapolitan-sixth";

export interface SpecializedConnectionFact {
  readonly connection: ConnectionView["connection"];
  readonly sourceSpan: HarmonySpan;
  readonly targetSpan: HarmonySpan;
  readonly sourceSlice: AnalysisSlice;
  readonly targetSlice: AnalysisSlice;
  readonly sourceChord: AnalysisChord;
  readonly targetChord: AnalysisChord;
  readonly sourceInterpretation?: HarmonyInterpretation;
  readonly targetInterpretation?: HarmonyInterpretation;
  readonly key: AnalysisKey;
}

function interpretationOf(context: HarmonyRuleContext, span: HarmonySpan) {
  const resolution = context.harmony.primaryInterpretation(span);
  return resolution.status === "resolved" ? resolution.value : undefined;
}

/**
 * 依据 QueryAPI 从连接上下文构建结构化、经过前置过滤的连接事实集合。
 * 核心拦截：过滤同和声跨切片连接（connection.relation === "same-harmony"），
 * 避免同一和弦在换位或时值切分时被误当异功能解决进行判定。
 */
export function specializedConnectionFacts(
  context: HarmonyRuleContext,
): readonly SpecializedConnectionFact[] {
  return context
    .connections()
    .where(({ connection, sourceBoundary, targetBoundary }) =>
      connection.contiguous &&
      connection.sameKey &&
      connection.relation !== "same-harmony" &&
      connection.confidence !== "ambiguous" &&
      connection.confidence !== "unknown" &&
      sourceBoundary.completeSatb &&
      targetBoundary.completeSatb &&
      Boolean(sourceBoundary.chord) &&
      Boolean(targetBoundary.chord),
    )
    .select((candidate): SpecializedConnectionFact => ({
      connection: candidate.connection,
      sourceSpan: candidate.source.span,
      targetSpan: candidate.target.span,
      sourceSlice: candidate.sourceBoundary,
      targetSlice: candidate.targetBoundary,
      sourceChord: candidate.sourceBoundary.chord!,
      targetChord: candidate.targetBoundary.chord!,
      sourceInterpretation: interpretationOf(context, candidate.source.span),
      targetInterpretation: interpretationOf(context, candidate.target.span),
      key: candidate.sourceBoundary.key,
    }))
    .toArray();
}

function toneMembers(
  slice: AnalysisSlice,
  chord: AnalysisChord,
  toneIndex: number,
) {
  const tone = chordIdentityToneSpellings(chord.identity)[toneIndex];
  if (!tone) return [];
  return activeNotes(slice).filter(({ note }) =>
    pitchClassEquals(note.pitch, tone),
  );
}

function targetConfigurationProblems(target: AnalysisSlice) {
  const chord = target.chord!;
  const tones = chordIdentityToneSpellings(chord.identity);
  const counts = tones.map(
    (tone) =>
      activeNotes(target).filter(({ note }) =>
        pitchClassEquals(note.pitch, tone),
      ).length,
  );
  const problems: string[] = [];
  if ((counts[0] ?? 0) === 0) problems.push("目标和弦缺少根音");
  if ((counts[1] ?? 0) === 0) problems.push("目标和弦缺少三音");
  return problems;
}

function dominantBassProblem(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
) {
  const sourceBass = fact.sourceSlice.notes.bass;
  const targetBass = fact.targetSlice.notes.bass;
  if (!sourceBass || !targetBass) return "低音上下文不完整";
  const inversion = chordInversion(fact.sourceChord);
  const targetTones = chordIdentityToneSpellings(fact.targetChord.identity);
  const interval = context.pitch.writtenIntervalBetween(
    sourceBass.pitch,
    targetBass.pitch,
  );
  const targetRoot = targetTones[0];
  const targetThird = targetTones[1];

  let matches = false;
  if (inversion === 0) {
    // 原位 D7: 跳进四五度至主和弦根音
    const targetMatches = Boolean(
      targetRoot && pitchClassEquals(targetBass.pitch, targetRoot),
    );
    const motionMatches = [5, 7].includes(Math.abs(interval.semitones) % 12);
    matches = targetMatches && motionMatches;
  } else if (inversion === 1) {
    // 五六和弦 D56: 低音导音上行二度级进至主和弦根音
    const targetMatches = Boolean(
      targetRoot && pitchClassEquals(targetBass.pitch, targetRoot),
    );
    const motionMatches = isWrittenStep(interval) && interval.semitones > 0;
    matches = targetMatches && motionMatches;
  } else if (inversion === 2) {
    // 三四和弦 D34 包含两组经典解决路径：
    // a) 下行二度进入原位主和弦根音 (2 -> 1)
    const resolvesToRoot =
      Boolean(targetRoot && pitchClassEquals(targetBass.pitch, targetRoot)) &&
      isWrittenStep(interval) &&
      interval.semitones < 0;
    // b) 上行二度进入第一转位主和弦三音 (2 -> 3，经过句 I - D34 - I6)
    const resolvesToThird =
      Boolean(targetThird && pitchClassEquals(targetBass.pitch, targetThird)) &&
      isWrittenStep(interval) &&
      interval.semitones > 0;
    matches = resolvesToRoot || resolvesToThird;
  } else if (inversion === 3) {
    // 二和弦 D2: 七音在低音，下行二度级进至主和弦第一转位三音 (4 -> 3, 即 I6)
    const targetMatches = Boolean(
      targetThird && pitchClassEquals(targetBass.pitch, targetThird),
    );
    const motionMatches = isWrittenStep(interval) && interval.semitones < 0;
    matches = targetMatches && motionMatches;
  }

  return matches
    ? undefined
    : `低音不符合 ${["D7", "D56", "D34", "D2"][inversion]} 的常用解决公式`;
}

interface SpecializedProblems {
  problems: string[];
  voices: VoiceId[];
  notes: AnalysisNote[];
}

interface SpecializedConnectionPolicy {
  id: SpecializedRuleId;
  sourceMatches(
    context: HarmonyRuleContext,
    span: HarmonySpan,
    chord: AnalysisChord,
    interpretation?: HarmonyInterpretation,
  ): boolean;
  targetAllowed(
    context: HarmonyRuleContext,
    span: HarmonySpan,
    interpretation?: HarmonyInterpretation,
  ): boolean;
  collectProblems(
    context: HarmonyRuleContext,
    fact: SpecializedConnectionFact,
  ): SpecializedProblems;
  coverageKinds?: readonly {
    kind: "leading-tone" | "chord-seventh" | "dominant-ninth";
    toneIndex: number;
  }[];
}

function hasSeventh(chord: AnalysisChord) {
  return (
    chord.identity.structure.kind === "tertian" &&
    chordIdentityToneSpellings(chord.identity).length >= 4
  );
}

function hasNinth(chord: AnalysisChord) {
  return (
    chord.identity.structure.kind === "tertian" &&
    chord.identity.structure.extensions.includes(9)
  );
}

function tonicTarget(context: HarmonyRuleContext, span: HarmonySpan) {
  const interpretation = interpretationOf(context, span);
  return (
    interpretation?.designation?.primaryFunction === "tonic" &&
    interpretation.degree === 1
  );
}

function dominantTarget(context: HarmonyRuleContext, span: HarmonySpan) {
  return (
    interpretationOf(context, span)?.designation?.primaryFunction ===
    "dominant"
  );
}

function dominantOrCadential64Target(
  context: HarmonyRuleContext,
  span: HarmonySpan,
) {
  const interpretation = interpretationOf(context, span);
  return (
    interpretation?.designation?.primaryFunction === "dominant" ||
    interpretation?.designation?.kind === "cadential64" ||
    span.semantics?.cadenceRole === "cadential64"
  );
}

function dominantSeventhProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const targetTones = chordIdentityToneSpellings(fact.targetChord.identity);
  const tonicPitch = targetTones[0];
  const dominantPitch = scaleDegreePitchClass(fact.key, 5, 0);

  // 1. 导音走向检查 (toneIndex: 1)
  toneMembers(fact.sourceSlice, fact.sourceChord, 1).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) {
      problems.push("导音未解决");
      voices.push(member.voiceId);
      notes.push(member.note);
      return;
    }
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const isStepUp =
      isWrittenStep(interval) &&
      interval.semitones > 0 &&
      pitchClassEquals(next.pitch, tonicPitch);
    // 内声部导音自由解决：Alto 或 Tenor 允许下行小三度跳进到主和弦五音 (7 -> 5)
    const isInnerVoiceFreeFalling =
      (member.voiceId === "alto" || member.voiceId === "tenor") &&
      Math.abs(interval.diatonicSteps) === 2 &&
      interval.semitones < 0 &&
      pitchClassEquals(next.pitch, dominantPitch);

    if (!isStepUp && !isInnerVoiceFreeFalling) {
      problems.push("导音未规范解决");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 2. 七音走向检查 (toneIndex: 3)
  toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) {
      problems.push("七音未解决");
      voices.push(member.voiceId);
      notes.push(member.note);
      return;
    }
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const isValid =
      isWrittenStep(interval) &&
      interval.semitones < 0 &&
      context.harmony.isWrittenChordTone(next, fact.targetChord);

    if (!isValid) {
      problems.push("七音未下行解决");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 3. 低音走向检查
  const bassProblem = dominantBassProblem(context, fact);
  if (bassProblem) problems.push(bassProblem);

  // 4. 目标和弦构成音完整度（根音、三音必须存在，五音可省略）
  problems.push(...targetConfigurationProblems(fact.targetSlice));

  // 注意：不再调用 commonToneProblems！完全属七 -> 不完全主和弦（省略五音）属音无保留，完全合规。
  return { problems, voices, notes };
}

function dominantNinthProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const targetTones = chordIdentityToneSpellings(fact.targetChord.identity);
  const tonicPitch = targetTones[0];

  if (chordInversion(fact.sourceChord) !== 0) {
    problems.push("当前仅支持原位 D9");
  }

  // 1. 导音走向检查 (toneIndex: 1, 必须上行至主音)
  toneMembers(fact.sourceSlice, fact.sourceChord, 1).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const valid =
      isWrittenStep(interval) &&
      interval.semitones > 0 &&
      pitchClassEquals(next.pitch, tonicPitch);
    if (!valid) {
      problems.push("导音未上行解决");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 2. 七音走向检查 (toneIndex: 3, 必须下行至三音)
  toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const valid =
      isWrittenStep(interval) &&
      interval.semitones < 0 &&
      context.harmony.isWrittenChordTone(next, fact.targetChord);
    if (!valid) {
      problems.push("七音未下行解决");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 3. 九音走向检查 (toneIndex: 4, 必须下行至五音)
  toneMembers(fact.sourceSlice, fact.sourceChord, 4).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const valid =
      isWrittenStep(interval) &&
      interval.semitones < 0 &&
      context.harmony.isWrittenChordTone(next, fact.targetChord);
    if (!valid) {
      problems.push("九音未下行解决");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 4. 低音跳进至主音
  const sourceBass = fact.sourceSlice.notes.bass;
  const targetBass = fact.targetSlice.notes.bass;
  if (sourceBass && targetBass) {
    const bassInterval = context.pitch.writtenIntervalBetween(
      sourceBass.pitch,
      targetBass.pitch,
    );
    const bassMatches =
      pitchClassEquals(targetBass.pitch, tonicPitch) &&
      [5, 7].includes(Math.abs(bassInterval.semitones) % 12);
    if (!bassMatches) problems.push("低音未跳进至主音");
  }

  // 5. 目标和弦构成
  problems.push(...targetConfigurationProblems(fact.targetSlice));
  // 彻底移除 commonToneProblems！四部和声中属九省略五音，根音在低音跳进，无法保留共同音。
  return { problems, voices, notes };
}

function leadingToneSeventhProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const isDominant =
    fact.targetInterpretation?.degree === 5 ||
    fact.targetInterpretation?.designation?.primaryFunction === "dominant";

  if (isDominant) {
    // 解决至属和弦/属七和弦 (D / D7):
    // 导音 (tones[0]) 保持为属和弦三音
    toneMembers(fact.sourceSlice, fact.sourceChord, 0).forEach((member) => {
      const next = fact.targetSlice.notes[member.voiceId];
      if (!next) return;
      const interval = context.pitch.writtenIntervalBetween(
        member.note.pitch,
        next.pitch,
      );
      if (interval.semitones !== 0) {
        problems.push("导音未作为共同音保持在同一声部");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    });
    // 七音 (tones[3]) 下行解决
    toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
      const next = fact.targetSlice.notes[member.voiceId];
      if (!next) return;
      const interval = context.pitch.writtenIntervalBetween(
        member.note.pitch,
        next.pitch,
      );
      if (!(isWrittenStep(interval) && interval.semitones < 0)) {
        problems.push("七音未下行解决");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    });
  } else {
    // 解决至主和弦 (T):
    // 导音 (tones[0]) 上行至主音
    toneMembers(fact.sourceSlice, fact.sourceChord, 0).forEach((member) => {
      const next = fact.targetSlice.notes[member.voiceId];
      if (!next) return;
      const interval = context.pitch.writtenIntervalBetween(
        member.note.pitch,
        next.pitch,
      );
      if (!(isWrittenStep(interval) && interval.semitones > 0)) {
        problems.push("导音未上行解决");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    });
    // 七音 (tones[3]) 下行至五音
    toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
      const next = fact.targetSlice.notes[member.voiceId];
      if (!next) return;
      const interval = context.pitch.writtenIntervalBetween(
        member.note.pitch,
        next.pitch,
      );
      if (!(isWrittenStep(interval) && interval.semitones < 0)) {
        problems.push("七音未下行解决");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    });
    problems.push(...targetConfigurationProblems(fact.targetSlice));
  }
  return { problems, voices, notes };
}

function supertonicAndSubdominantSeventhProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const isCadential64 =
    fact.targetInterpretation?.designation?.kind === "cadential64" ||
    fact.targetSpan.semantics?.cadenceRole === "cadential64";

  // 七音走向检查 (tones[3])
  toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    if (isCadential64) {
      // 解决至 K46: 七音作为六度挂留音在同一声部保持！
      const isHeld =
        interval.semitones === 0 &&
        context.harmony.isWrittenChordTone(next, fact.targetChord);
      if (!isHeld) {
        problems.push("七音未在 K46 中作为共同音保持");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    } else {
      // 解决至属和弦 (V/V7): 七音必须下行级进！
      const isStepDown =
        isWrittenStep(interval) &&
        interval.semitones < 0 &&
        context.harmony.isWrittenChordTone(next, fact.targetChord);
      if (!isStepDown) {
        problems.push("七音未下行解决");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    }
  });

  return { problems, voices, notes };
}

function doubleDominantSeventhProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const isCadential64 =
    fact.targetInterpretation?.designation?.kind === "cadential64" ||
    fact.targetSpan.semantics?.cadenceRole === "cadential64";
  const dominantPitch = scaleDegreePitchClass(fact.key, 5, 0);

  // 1. 三音（升4级，属调导音，tones[1]）：必须严格上行半音级进至属音 5 级！
  toneMembers(fact.sourceSlice, fact.sourceChord, 1).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const valid =
      interval.semitones === 1 && pitchClassEquals(next.pitch, dominantPitch);
    if (!valid) {
      problems.push("属调导音（升 IV 级）未上半音解决至属音");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 2. 七音（1级音，tones[3]）：
  toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    if (isCadential64) {
      // 进 K46 时保持同音！
      const valid = interval.semitones === 0;
      if (!valid) {
        problems.push("七音未在 K46 中作为共同音保持");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    } else {
      // 进 V 时下行级进至导音
      const valid = isWrittenStep(interval) && interval.semitones < 0;
      if (!valid) {
        problems.push("七音未下行解决");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    }
  });

  return { problems, voices, notes };
}

function doubleDominantLeadingToneProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const isCadential64 =
    fact.targetInterpretation?.designation?.kind === "cadential64" ||
    fact.targetSpan.semantics?.cadenceRole === "cadential64";
  const dominantPitch = scaleDegreePitchClass(fact.key, 5, 0);

  // 1. 导音（升4级，tones[0]）：必须上行半音至属音 5 级
  toneMembers(fact.sourceSlice, fact.sourceChord, 0).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const valid =
      interval.semitones === 1 && pitchClassEquals(next.pitch, dominantPitch);
    if (!valid) {
      problems.push("属调导音（升 IV 级）未上半音解决至属音");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 2. 七音（降6级，tones[3]）：必须下行半音至属音 5 级
  toneMembers(fact.sourceSlice, fact.sourceChord, 3).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    const valid =
      interval.semitones === -1 && pitchClassEquals(next.pitch, dominantPitch);
    if (!valid) {
      problems.push("重属七音（降 VI 级）未下半音解决至属音");
      voices.push(member.voiceId);
      notes.push(member.note, next);
    }
  });

  // 3. 构成音 3（1 级音，tones[2]）：
  toneMembers(fact.sourceSlice, fact.sourceChord, 2).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    if (!next) return;
    const interval = context.pitch.writtenIntervalBetween(
      member.note.pitch,
      next.pitch,
    );
    if (isCadential64) {
      // 进 K46 时保持同音！
      if (interval.semitones !== 0) {
        problems.push("构成音 3未在 K46 中作为共同音保持");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    } else {
      // 进 V 时下行级进至导音
      if (!(isWrittenStep(interval) && interval.semitones < 0)) {
        problems.push("构成音 3未下行级进解决");
        voices.push(member.voiceId);
        notes.push(member.note, next);
      }
    }
  });

  return { problems, voices, notes };
}

function neapolitanProblems(
  context: HarmonyRuleContext,
  fact: SpecializedConnectionFact,
): SpecializedProblems {
  const problems: string[] = [];
  const voices: VoiceId[] = [];
  const notes: AnalysisNote[] = [];
  const tones = chordIdentityToneSpellings(fact.sourceChord.identity);
  const counts = tones.map(
    (tone) =>
      activeNotes(fact.sourceSlice).filter(({ note }) =>
        pitchClassEquals(note.pitch, tone),
      ).length,
  );
  if (chordInversion(fact.sourceChord) !== 1) {
    problems.push("N6 应使用第一转位");
  }
  if (counts[1] !== 2) {
    problems.push("N6 通常重复低音所代表的 IV 级音");
  }

  // 降 II 级音 (tones[0]) 下行进入导音或主音
  toneMembers(fact.sourceSlice, fact.sourceChord, 0).forEach((member) => {
    const next = fact.targetSlice.notes[member.voiceId];
    const interval = next
      ? context.pitch.writtenIntervalBetween(member.note.pitch, next.pitch)
      : undefined;
    if (
      !next ||
      !context.harmony.isWrittenChordTone(next, fact.targetChord) ||
      !interval ||
      interval.semitones >= 0 ||
      Math.abs(interval.semitones) > 3
    ) {
      problems.push("降 II 级音未按书写方向下行进入目标");
      voices.push(member.voiceId);
      notes.push(member.note, ...(next ? [next] : []));
    }
  });

  return { problems, voices, notes };
}

function resolutionCoverageReferences(
  fact: SpecializedConnectionFact,
  kinds: NonNullable<SpecializedConnectionPolicy["coverageKinds"]>,
) {
  return kinds.flatMap(({ kind, toneIndex }) =>
    toneMembers(fact.sourceSlice, fact.sourceChord, toneIndex).map(
      ({ voiceId }) =>
        `resolution.${kind}|${fact.connection.connectionKey}|voice:${voiceId}`,
    ),
  );
}

function evaluateSpecializedConnection(
  ruleContext: HarmonyRuleContext,
  policy: SpecializedConnectionPolicy,
) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const fact of specializedConnectionFacts(ruleContext)) {
    if (
      !policy.sourceMatches(
        ruleContext,
        fact.sourceSpan,
        fact.sourceChord,
        fact.sourceInterpretation,
      )
    )
      continue;
    const result = policy.collectProblems(ruleContext, fact);
    if (
      !policy.targetAllowed(
        ruleContext,
        fact.targetSpan,
        fact.targetInterpretation,
      )
    )
      result.problems.unshift("后继功能不符合该和弦的目标集合");
    if (result.problems.length === 0) continue;

    const allNotes = [
      ...activeNotes(fact.sourceSlice).map(({ note }) => note),
      ...activeNotes(fact.targetSlice).map(({ note }) => note),
      ...result.notes,
    ];
    diagnostics.push(
      diagnostic(
        policy.id,
        fact.targetSlice.tick,
        fact.targetSlice.endTick,
        [...new Set(result.voices)],
        [...new Map(allNotes.map((note) => [note.id, note])).values()],
        `${chordLabel(fact.sourceChord)} 连接配置不规范`,
        `${chordLabel(fact.sourceChord)} -> ${chordLabel(fact.targetChord)}：${[
          ...new Set(result.problems),
        ].join("；")}。`,
        {
          chordIds: [fact.sourceChord.id, fact.targetChord.id],
          causeRefs: [`${policy.id}|${fact.connection.connectionKey}`],
          coverageRefs: policy.coverageKinds
            ? resolutionCoverageReferences(fact, policy.coverageKinds)
            : [],
          evidence: [
            chordEvidence(fact.sourceChord),
            chordEvidence(fact.targetChord),
          ],
        },
      ),
    );
  }
  return diagnostics;
}

const DOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.dominant-seventh",
  sourceMatches: (_context, _span, chord, interpretation) => {
    const kind = interpretation?.designation?.kind;
    return (
      hasSeventh(chord) &&
      !hasNinth(chord) &&
      interpretation?.degree === 5 &&
      interpretation.designation?.primaryFunction === "dominant" &&
      kind !== "applied-dominant" &&
      kind !== "double-dominant"
    );
  },
  targetAllowed: (context, span, interp) => {
    // 允许解决至主和弦；若标记或呈现为阻碍进行 (D -> TSVI)，也予以豁免交由 H.12
    const isDeceptive =
      span.semantics?.cadenceRole === "deceptive" ||
      (interp?.degree === 6 &&
        interp?.designation?.primaryFunction === "tonic");
    return tonicTarget(context, span) || isDeceptive;
  },
  collectProblems: dominantSeventhProblems,
  coverageKinds: [
    { kind: "leading-tone", toneIndex: 1 },
    { kind: "chord-seventh", toneIndex: 3 },
  ],
};

const DOMINANT_NINTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.dominant-ninth",
  sourceMatches: (_context, _span, chord, interpretation) => {
    const kind = interpretation?.designation?.kind;
    return (
      hasNinth(chord) &&
      interpretation?.degree === 5 &&
      interpretation.designation?.primaryFunction === "dominant" &&
      kind !== "applied-dominant" &&
      kind !== "double-dominant"
    );
  },
  targetAllowed: tonicTarget,
  collectProblems: dominantNinthProblems,
  coverageKinds: [
    { kind: "leading-tone", toneIndex: 1 },
    { kind: "chord-seventh", toneIndex: 3 },
    { kind: "dominant-ninth", toneIndex: 4 },
  ],
};

const LEADING_TONE_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.leading-tone-seventh",
  sourceMatches: (_context, _span, chord, interpretation) => {
    const kind = interpretation?.designation?.kind;
    return (
      hasSeventh(chord) &&
      interpretation?.degree === 7 &&
      interpretation.designation?.primaryFunction === "dominant" &&
      kind !== "applied-leading-tone" &&
      kind !== "double-dominant-leading-tone"
    );
  },
  targetAllowed: (context, span) =>
    tonicTarget(context, span) || dominantTarget(context, span),
  collectProblems: leadingToneSeventhProblems,
};

const SUPERTONIC_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.supertonic-seventh",
  sourceMatches: (_context, _span, chord, interpretation) =>
    hasSeventh(chord) &&
    interpretation?.degree === 2 &&
    interpretation.designation?.primaryFunction === "subdominant",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: supertonicAndSubdominantSeventhProblems,
};

const SUBDOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.subdominant-seventh",
  sourceMatches: (_context, _span, chord, interpretation) =>
    hasSeventh(chord) &&
    interpretation?.degree === 4 &&
    interpretation.designation?.primaryFunction === "subdominant",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: supertonicAndSubdominantSeventhProblems,
};

const DOUBLE_DOMINANT_SEVENTH_POLICY: SpecializedConnectionPolicy = {
  id: "connection.double-dominant-seventh",
  sourceMatches: (_context, _span, chord, interpretation) =>
    hasSeventh(chord) && interpretation?.designation?.kind === "double-dominant",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: doubleDominantSeventhProblems,
};

const DOUBLE_DOMINANT_LEADING_TONE_POLICY: SpecializedConnectionPolicy = {
  id: "connection.double-dominant-leading-tone",
  sourceMatches: (_context, _span, chord, interpretation) =>
    hasSeventh(chord) &&
    interpretation?.designation?.kind === "double-dominant-leading-tone",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: doubleDominantLeadingToneProblems,
};

const NEAPOLITAN_POLICY: SpecializedConnectionPolicy = {
  id: "connection.neapolitan-sixth",
  sourceMatches: (_context, span, _chord, interpretation) =>
    (interpretation ?? interpretationOf(_context, span))?.designation?.kind ===
    "neapolitan",
  targetAllowed: dominantOrCadential64Target,
  collectProblems: neapolitanProblems,
};

export function dominantSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, DOMINANT_SEVENTH_POLICY);
}

export function dominantNinthConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, DOMINANT_NINTH_POLICY);
}

export function leadingToneSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, LEADING_TONE_SEVENTH_POLICY);
}

export function supertonicSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, SUPERTONIC_SEVENTH_POLICY);
}

export function subdominantSeventhConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, SUBDOMINANT_SEVENTH_POLICY);
}

export function doubleDominantSeventhConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateSpecializedConnection(
    context,
    DOUBLE_DOMINANT_SEVENTH_POLICY,
  );
}

export function doubleDominantLeadingToneConnectionRule(
  context: HarmonyRuleContext,
) {
  return evaluateSpecializedConnection(
    context,
    DOUBLE_DOMINANT_LEADING_TONE_POLICY,
  );
}

export function neapolitanSixthConnectionRule(context: HarmonyRuleContext) {
  return evaluateSpecializedConnection(context, NEAPOLITAN_POLICY);
}

export function ambiguousConnectionRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  const ambiguousCandidates = context
    .connections()
    .where(
      ({ connection }) =>
        connection.confidence === "ambiguous" ||
        connection.confidence === "unknown",
    );

  for (const { connection, source, target } of ambiguousCandidates) {
    const sourceSpan = source.span;
    const targetSpan = target.span;
    const candidates = [sourceSpan, targetSpan].filter(
      (span): span is HarmonySpan =>
        Boolean(
          span?.semantics &&
          (span.semantics.interpretations.length > 1 ||
            (span.semantics.alternatives?.length ?? 0) > 0),
        ),
    );
    if (candidates.length === 0) continue;
    const chordIds = candidates.flatMap((span) => [...span.regionIds]);
    diagnostics.push(
      diagnostic(
        "function.ambiguous-connection",
        targetSpan.fromTick,
        targetSpan.fromTick,
        [],
        [],
        "功能连接存在互斥解释",
        "前后和弦具有多个会导向不同连接结论的语意解释，请确认主要解释后再应用功能规则。",
        {
          chordIds,
          confidence: 0.6,
          causeRefs: [
            `function.ambiguous-connection|${connection.connectionKey}`,
          ],
          evidence: candidates.map((span) => ({
            kind: "function" as const,
            label: "候选解释数",
            value: String(
              (span.semantics?.interpretations.length ?? 0) +
                (span.semantics?.alternatives?.length ?? 0),
            ),
          })),
        },
      ),
    );
  }
  return diagnostics;
}

export function secondInversionContextRule(context: HarmonyRuleContext) {
  const diagnostics: RuleDiagnostic[] = [];
  for (const current of context.spans()) {
    const span = current.span;
    const role = span.semantics?.cadenceRole;
    if (role !== "passing64" && role !== "pedal64" && role !== "cadential64")
      continue;
    const neighborhood = context.spanNeighborhood(current);
    const previous = neighborhood.previous;
    const next = neighborhood.next;
    if (!previous || !next) continue;
    const previousSpan = previous.span;
    const nextSpan = next.span;
    const previousSlice = previous.lastSlice;
    const firstSlice = current.firstSlice;
    const lastSlice = current.lastSlice;
    const nextSlice = next.firstSlice;
    if (
      !previousSlice?.notes.bass ||
      !firstSlice?.notes.bass ||
      !lastSlice?.notes.bass ||
      !nextSlice?.notes.bass ||
      !firstSlice.chord ||
      chordInversion(firstSlice.chord) !== 2
    )
      continue;
    const into = context.pitch.writtenIntervalBetween(
      previousSlice.notes.bass.pitch,
      firstSlice.notes.bass.pitch,
    );
    const out = context.pitch.writtenIntervalBetween(
      lastSlice.notes.bass.pitch,
      nextSlice.notes.bass.pitch,
    );
    const nextInterpretation = interpretationOf(context, nextSpan);
    const nextDesignation =
      nextInterpretation && nextSpan.semantics && nextSlice.chord
        ? effectiveFunctionalDesignation(
            nextSpan.semantics,
            chordStructureQuality(nextSlice.chord.identity),
          )
        : undefined;
    const valid =
      role === "passing64"
        ? (Math.abs(into.diatonicSteps) === 1 ||
            Math.abs(into.semitones) <= 2) &&
          (Math.abs(out.diatonicSteps) === 1 ||
            Math.abs(out.semitones) <= 2) &&
          Math.sign(into.semitones) === Math.sign(out.semitones)
        : role === "pedal64"
          ? pitchClassEquals(
              previousSlice.notes.bass.pitch,
              firstSlice.notes.bass.pitch,
            ) &&
            pitchClassEquals(
              lastSlice.notes.bass.pitch,
              nextSlice.notes.bass.pitch,
            ) &&
            previousSpan.identityKey === nextSpan.identityKey
          : pitchClassEquals(
              lastSlice.notes.bass.pitch,
              nextSlice.notes.bass.pitch,
            ) &&
            nextDesignation?.primaryFunction === "dominant";
    if (valid) continue;
    const currentBassNotes = [
      ...new Map(
        [firstSlice.notes.bass, lastSlice.notes.bass].map((note) => [
          note.id,
          note,
        ]),
      ).values(),
    ];
    const contextBassNotes = [
      ...new Map(
        [previousSlice.notes.bass, nextSlice.notes.bass].map((note) => [
          note.id,
          note,
        ]),
      ).values(),
    ];
    diagnostics.push(
      diagnostic(
        "connection.second-inversion-context",
        span.fromTick,
        span.toTick,
        ["bass"],
        [
          previousSlice.notes.bass,
          firstSlice.notes.bass,
          lastSlice.notes.bass,
          nextSlice.notes.bass,
        ],
        "四六和弦语境与标注不一致",
        role === "passing64"
          ? "经过四六要求低音以同方向级进贯穿前、中、后三个和声。"
          : role === "pedal64"
            ? "辅助四六要求低音保持，并回到原和弦。"
            : "终止四六应保持属音低音进入后继属功能。",
        {
          chordIds: [...span.regionIds],
          evidence: [chordEvidence(firstSlice.chord)],
          subjects: {
            origin: {
              voiceIds: ["bass"],
              noteIds: currentBassNotes.map((note) => note.id),
              chordIds: [...span.regionIds],
              spanIds: [span.id],
            },
            context: {
              voiceIds: ["bass"],
              noteIds: contextBassNotes.map((note) => note.id),
              chordIds: [
                ...previousSpan.regionIds,
                ...nextSpan.regionIds,
              ],
              spanIds: [previousSpan.id, nextSpan.id],
            },
          },
        },
      ),
    );
  }
  return diagnostics;
}

export const SPECIALIZED_CONNECTION_RULES = defineRuleGroup(
  defineStatelessRule({
    id: "function.ambiguous-connection",
    catalogNumber: "G.6",
    label: "功能连接语义不足",
    description:
      "检查和弦连接是否存在多种模棱两可的功能解释且缺乏主导调性支持。",
    rationale:
      "良好的和声进行应具备清晰明确的功能逻辑序列。当和弦音响可以被解释为多种相互冲突的功能关系时，表明调性中心模糊或声部连接逻辑欠明确。",
    group: "function",
    defaultSeverity: "suggestion",
    requires: ["chords"],
    dependencyScope: "phrase",
    evaluate: ambiguousConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.dominant-seventh",
    catalogNumber: "H.1",
    label: "D7 解决配置",
    description:
      "检查大小七和弦（D7 及其转位）进入主和弦时导音、七音及低音的解决规范。",
    rationale:
      "属七和弦包含三全音矛盾（导音与下属音）。标准解决要求：导音（3音）上行半音至主音，七音（7音）下行级进至三音，低音由 5 级跳至 1 级（原位）或级进（转位）。原位 D7 解决到原位 T 通常为“完全到不完全”（三根一三，省略五音）或“不完全到完全”。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: ["resolution.leading-tone", "resolution.chord-seventh"],
    evaluate: dominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.dominant-ninth",
    catalogNumber: "H.2",
    label: "D9 解决配置",
    description:
      "检查大/小属九和弦（D9）进入主和弦时九音、七音、导音的同步解决。",
    rationale:
      "属九和弦拥有两个核心倾向音——九音与七音。解决时，九音与七音必须同时向下级进解决至主和弦的五音与三音，导音向上解决至主音，低音跳进至主音。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    coveredRuleIds: [
      "resolution.leading-tone",
      "resolution.chord-seventh",
      "resolution.dominant-ninth",
    ],
    evaluate: dominantNinthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.leading-tone-seventh",
    catalogNumber: "H.3",
    label: "DVII7 解决配置",
    description:
      "检查导七和弦（减七或半减七和弦）进入主和弦时的声部倾向解决。",
    rationale:
      "导七和弦（DVII7）包含两个减五度/增四度音程，紧张度极高。低音（导音）上行解决至主音，七音下行解决至五音，减五度音（三音与五音）分别向内级进收缩解决，通常直接导向重复三音的主三和弦。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: leadingToneSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.supertonic-seventh",
    catalogNumber: "H.4",
    label: "SII7 进入属功能",
    description:
      "检查二级七和弦（SII7）连接至属和弦（V）或终止四六（K46）时的声部进行。",
    rationale:
      "二级七和弦（大调小七、小调半减七）是主要的下属功能七和弦。连接到 Ⅴ 级时，七音（调式主音 1 级）必须顺应倾向下行级进至导音（7 级），或保持为 K46 的六度挂留音。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: supertonicSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.subdominant-seventh",
    catalogNumber: "H.5",
    label: "S7 进入属功能",
    description:
      "检查四级七和弦（S7）连接到属功能和弦时的七音下行解决与平稳进行。",
    rationale:
      "四级七和弦七音为调式第 3 级音。连接到属和弦时，该七音应平稳下行级进至属和弦的 2 级音（五音），低音走级进或四五度跳进，避免不良平行。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: subdominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.double-dominant-seventh",
    catalogNumber: "H.6",
    label: "DD7 解决配置",
    description:
      "检查重属七和弦（DD7）引入升4级变化导音后是否规范进入属和弦或 K46。",
    rationale:
      "重属七和弦是向属和弦离调的大附属性和弦。其三音（升Ⅳ级，即属调导音）必须严格上行半音解决至属音（Ⅴ级），七音（调式主音 1 级）下行半音/全音至导音或作为共同音保持。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: doubleDominantSeventhConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.double-dominant-leading-tone",
    catalogNumber: "H.7",
    label: "DDVII7 解决配置",
    description:
      "检查重属导七和弦（DDVII7）中各变化倾向音向属和弦的平稳解决。",
    rationale:
      "重属导七和弦（通常为减七和弦结构）蕴含极强的色彩张力。升Ⅳ级低音上行至属音，其降Ⅵ级七音下行至属和弦五音，多用于高潮段落的属和声准备。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: doubleDominantLeadingToneConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.neapolitan-sixth",
    catalogNumber: "H.8",
    label: "N6 连接",
    description:
      "检查那波里六和弦（降II级六和弦 N6）进入属和弦或 K46 时的低音重复与降2级解决。",
    rationale:
      "那波里六和弦是包含降Ⅱ级音的大三和弦第一转位。低音为调内下属音（Ⅳ级），四声部中必须重复低音（Ⅳ级）；最具特征的降Ⅱ级音必须严格下行减三度跳进至导音，或下行半音至主音（经 K46 解决）。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: neapolitanSixthConnectionRule,
  }),
  defineStatelessRule({
    id: "connection.second-inversion-context",
    catalogNumber: "H.13",
    label: "六四和弦进入与离开",
    description:
      "检查经过四六、辅助四六等第二转位和弦的低音线条是否具有连贯的级进或保持。",
    rationale:
      "由于第二转位和弦低音与上方声部的四度不协和性，四六和弦绝不能随意跳进进入或跳进离开。经过四六和弦的低音必须由级进经过形成（如 Ⅰ-Ⅴ46-Ⅰ6）；辅助四六和弦的低音必须保持同音不动（如 Ⅰ-Ⅳ46-Ⅰ）。",
    group: "connection",
    defaultSeverity: "warning",
    requires: ["written-pitches", "chords", "semantics"],
    dependencyScope: "phrase",
    evaluate: secondInversionContextRule,
  }),
);
