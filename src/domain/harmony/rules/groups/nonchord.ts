import { chordIdentityToneSpellings } from "../../../chordModel";
import type {
  AnalysisNote,
  AnalysisSlice,
  HarmonyAnalysis,
} from "../../analysis";
import type { RuleDiagnostic } from "../../runtime";
import type { NonChordToneRole, VoiceId } from "../../../project";
import { pitchClassEquals, toMidi, writtenInterval } from "../../../pitch";
import {
  chordEvidence,
  diagnostic,
  noteEvidence,
  voiceName,
} from "../helpers/core";
import { defineRuleBindings, statelessRule } from "../binding";

type NonchordRuleId =
  | "nonchord.passing-tone"
  | "nonchord.neighbor-tone"
  | "nonchord.suspension-preparation"
  | "nonchord.suspension-resolution"
  | "nonchord.retardation"
  | "nonchord.appoggiatura"
  | "nonchord.anticipation"
  | "nonchord.pedal-point";

function sliceAtTick(analysis: HarmonyAnalysis, tick: number) {
  return analysis.slices.find(
    (slice) => slice.tick <= tick && tick < slice.endTick,
  );
}

function isChordTone(note: AnalysisNote, slice: AnalysisSlice | undefined) {
  return Boolean(
    slice?.chord &&
      chordIdentityToneSpellings(slice.chord.identity).some((tone) =>
        pitchClassEquals(note.pitch, tone),
      ),
  );
}

function isStep(from: AnalysisNote, to: AnalysisNote) {
  const interval = writtenInterval(from.pitch, to.pitch);
  return (
    Math.abs(interval.diatonicSteps) === 1 &&
    Math.abs(interval.semitones) >= 1 &&
    Math.abs(interval.semitones) <= 2
  );
}

function noteContext(
  analysis: HarmonyAnalysis,
  voiceId: VoiceId,
  note: AnalysisNote,
) {
  const line = analysis.notesByVoice[voiceId];
  const index = line.findIndex((candidate) => candidate.id === note.id);
  const previous = index > 0 ? line[index - 1] : undefined;
  const next = index >= 0 ? line[index + 1] : undefined;
  return {
    previous,
    next,
    previousSlice: previous ? sliceAtTick(analysis, previous.startTick) : undefined,
    currentSlice: sliceAtTick(analysis, note.startTick),
    nextSlice: next ? sliceAtTick(analysis, next.startTick) : undefined,
  };
}

function roleForRule(ruleId: NonchordRuleId): NonChordToneRole {
  if (ruleId === "nonchord.passing-tone") return "passing";
  if (ruleId === "nonchord.neighbor-tone") return "neighbor";
  if (
    ruleId === "nonchord.suspension-preparation" ||
    ruleId === "nonchord.suspension-resolution"
  )
    return "suspension";
  if (ruleId === "nonchord.retardation") return "retardation";
  if (ruleId === "nonchord.appoggiatura") return "appoggiatura";
  if (ruleId === "nonchord.anticipation") return "anticipation";
  return "pedal";
}

function suspensionEntry(
  analysis: HarmonyAnalysis,
  voiceId: VoiceId,
  note: AnalysisNote,
) {
  const outsideIndex = analysis.slices.findIndex(
    (slice) =>
      slice.notes[voiceId]?.id === note.id &&
      slice.chord &&
      !isChordTone(note, slice),
  );
  if (outsideIndex < 0) return undefined;
  const current = analysis.slices[outsideIndex];
  const previousSlice = analysis.slices[outsideIndex - 1];
  const line = analysis.notesByVoice[voiceId];
  const noteIndex = line.findIndex((candidate) => candidate.id === note.id);
  const previousAttack = noteIndex > 0 ? line[noteIndex - 1] : undefined;
  const preparedByHeldNote = Boolean(
    previousSlice?.chord &&
      previousSlice.endTick === current.tick &&
      previousSlice.notes[voiceId]?.id === note.id &&
      isChordTone(note, previousSlice),
  );
  const preparedByReattack = Boolean(
    previousSlice?.chord &&
      previousAttack &&
      previousAttack.startTick + previousAttack.durationTicks === note.startTick &&
      toMidi(previousAttack.pitch) === toMidi(note.pitch) &&
      isChordTone(previousAttack, previousSlice),
  );
  return {
    current,
    previousSlice,
    previousAttack,
    prepared: preparedByHeldNote || preparedByReattack,
  };
}

function pushRoleDiagnostic(
  diagnostics: RuleDiagnostic[],
  analysis: HarmonyAnalysis,
  ruleId: NonchordRuleId,
  voiceId: VoiceId,
  note: AnalysisNote,
  title: string,
  message: string,
  related: readonly AnalysisNote[] = [],
  slice?: AnalysisSlice,
) {
  diagnostics.push(
    diagnostic(
      ruleId,
      note.startTick,
      note.startTick + note.durationTicks,
      [voiceId],
      [note, ...related],
      title,
      message,
      {
        chordIds: slice?.chord ? [slice.chord.id] : [],
        evidence: [
          ...(slice?.chord ? [chordEvidence(slice.chord)] : []),
          noteEvidence(note, `${voiceName(analysis, voiceId)}标注音`),
          ...related.map((item) => noteEvidence(item, "相邻结构音")),
        ],
      },
    ),
  );
}

export function nonchordRoleRule(
  analysis: HarmonyAnalysis,
  ruleId: NonchordRuleId,
) {
  const diagnostics: RuleDiagnostic[] = [];
  const role = roleForRule(ruleId);

  (["soprano", "alto", "tenor", "bass"] as const).forEach((voiceId) => {
      analysis.notesByVoice[voiceId]
        .filter((note) => note.nonChordToneRole === role)
        .forEach((note) => {
          const context = noteContext(analysis, voiceId, note);
          const { previous, next, previousSlice, currentSlice, nextSlice } =
            context;

          if (ruleId === "nonchord.passing-tone") {
            if (!previous || !next || !currentSlice?.chord) return;
            const entering = writtenInterval(previous.pitch, note.pitch);
            const leaving = writtenInterval(note.pitch, next.pitch);
            const valid =
              !isChordTone(note, currentSlice) &&
              isChordTone(previous, previousSlice) &&
              isChordTone(next, nextSlice) &&
              isStep(previous, note) &&
              isStep(note, next) &&
              Math.sign(entering.semitones) === Math.sign(leaving.semitones);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "经过音角色不成立",
                "经过音应在两个结构音之间同向级进进入和离开。",
                [previous, next],
                currentSlice,
              );
            return;
          }

          if (ruleId === "nonchord.neighbor-tone") {
            if (!previous || !next || !currentSlice?.chord) return;
            const entering = writtenInterval(previous.pitch, note.pitch);
            const leaving = writtenInterval(note.pitch, next.pitch);
            const valid =
              !isChordTone(note, currentSlice) &&
              isChordTone(previous, previousSlice) &&
              isChordTone(next, nextSlice) &&
              isStep(previous, note) &&
              isStep(note, next) &&
              Math.sign(entering.semitones) === -Math.sign(leaving.semitones) &&
              toMidi(previous.pitch) === toMidi(next.pitch) &&
              pitchClassEquals(previous.pitch, next.pitch);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "辅助音角色不成立",
                "辅助音应级进离开结构音，并反向级进回到同一书写音高。",
                [previous, next],
                currentSlice,
              );
            return;
          }

          if (ruleId === "nonchord.suspension-preparation") {
            const entry = suspensionEntry(analysis, voiceId, note);
            if (!entry || entry.prepared) return;
            pushRoleDiagnostic(
              diagnostics,
              analysis,
              ruleId,
              voiceId,
              note,
              "挂留音准备不正确",
              "挂留音应在前一和弦中作为构成音同高准备，并跨越和声边界保持或重奏。",
              entry.previousAttack ? [entry.previousAttack] : [],
              entry.current,
            );
            return;
          }

          if (
            ruleId === "nonchord.suspension-resolution" ||
            ruleId === "nonchord.retardation"
          ) {
            const entry = suspensionEntry(analysis, voiceId, note);
            if (!entry || !next || !nextSlice?.chord) return;
            const interval = writtenInterval(note.pitch, next.pitch);
            const expectedDirection =
              ruleId === "nonchord.retardation" ? 1 : -1;
            const valid =
              entry.prepared &&
              isStep(note, next) &&
              Math.sign(interval.semitones) === expectedDirection &&
              isChordTone(next, nextSlice);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                ruleId === "nonchord.retardation"
                  ? "延宕音角色不成立"
                  : "挂留音未正确解决",
                ruleId === "nonchord.retardation"
                  ? "延宕音应同高准备，并上行级进解决到当前和弦音。"
                  : "挂留音应同高准备，并通常下行级进解决到当前和弦音。",
                [next],
                entry.current,
              );
            return;
          }

          if (ruleId === "nonchord.appoggiatura") {
            if (!previous || !next || !currentSlice?.chord || !nextSlice?.chord)
              return;
            const entryInterval = writtenInterval(previous.pitch, note.pitch);
            const valid =
              !isChordTone(note, currentSlice) &&
              isStep(note, next) &&
              isChordTone(next, nextSlice) &&
              (Math.abs(entryInterval.diatonicSteps) > 1 ||
                Math.abs(entryInterval.semitones) > 2);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "倚音角色不成立",
                "倚音通常以跳进或无准备方式进入，并级进解决到和弦音。",
                [previous, next],
                currentSlice,
              );
            return;
          }

          if (ruleId === "nonchord.anticipation") {
            if (!currentSlice?.chord) return;
            const currentSpanId = analysis.sliceSpanIds.get(currentSlice.index);
            const targetSlice = analysis.slices.find(
              (slice) =>
                slice.tick > note.startTick &&
                analysis.sliceSpanIds.get(slice.index) !== currentSpanId &&
                slice.chord,
            );
            if (!targetSlice?.chord) return;
            const repeatedByNext = Boolean(
              next &&
                note.startTick + note.durationTicks === next.startTick &&
                next.startTick === targetSlice.tick &&
                toMidi(next.pitch) === toMidi(note.pitch),
            );
            const heldIntoTarget =
              note.startTick + note.durationTicks > targetSlice.tick;
            const valid =
              !isChordTone(note, currentSlice) &&
              isChordTone(note, targetSlice) &&
              (heldIntoTarget || repeatedByNext);
            if (!valid)
              pushRoleDiagnostic(
                diagnostics,
                analysis,
                ruleId,
                voiceId,
                note,
                "先现音角色不成立",
                "先现音应先于紧邻后继和弦出现，并在该和弦中成为保持或重复的构成音。",
                next ? [next] : [],
                currentSlice,
              );
            return;
          }

          const overlapping = analysis.slices.filter(
            (slice) =>
              slice.chord &&
              slice.tick < note.startTick + note.durationTicks &&
              slice.endTick > note.startTick,
          );
          const distinctSpans = new Set(
            overlapping
              .map((slice) => analysis.sliceSpanIds.get(slice.index))
              .filter(Boolean),
          );
          if (overlapping.length === 0 || distinctSpans.size < 2) return;
          const first = overlapping[0];
          const last = overlapping.at(-1)!;
          const valid =
            isChordTone(note, first) &&
            isChordTone(note, last);
          if (!valid)
            pushRoleDiagnostic(
              diagnostics,
              analysis,
              ruleId,
              voiceId,
              note,
              "持续音语境不成立",
              "持续音应从明确和弦归属开始，跨越多个和声后重新获得和弦归属。",
              [],
              first,
            );
        });
  });
  return diagnostics;
}

export const NONCHORD_RULE_BINDINGS = defineRuleBindings({
  "nonchord.passing-tone": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.passing-tone"),
  ),
  "nonchord.neighbor-tone": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.neighbor-tone"),
  ),
  "nonchord.suspension-preparation": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.suspension-preparation"),
  ),
  "nonchord.suspension-resolution": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.suspension-resolution"),
  ),
  "nonchord.retardation": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.retardation"),
  ),
  "nonchord.appoggiatura": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.appoggiatura"),
  ),
  "nonchord.anticipation": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.anticipation"),
  ),
  "nonchord.pedal-point": statelessRule((analysis) =>
    nonchordRoleRule(analysis, "nonchord.pedal-point"),
  ),
});
