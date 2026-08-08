import {
  chordIdentityToneSpellings,
  chordIdentityToneSpellingForDegree,
  chordVoicingPolicy,
  harmonySemanticsCompatibleWithIdentity,
  primaryHarmonyInterpretation,
} from "../../../chordModel";
import { analysisKeyAtTick, type HarmonyAnalysis } from "../../analysis";
import type { RuleConfig, RuleDiagnostic } from "../../runtime";
import {
  formatPitchClass,
  pitchClassEquals,
  scaleDegreePitchClass,
  toMidi,
  type SpelledPitchClass,
} from "../../../pitch";
import {
  activeNotes,
  chordEvidence,
  chordLabel,
  diagnostic,
  finalSameHarmonySlice,
  hasExactPitch,
  noteEvidence,
  supportsTertianResolutionRules,
} from "../helpers/core";

export function chordSliceRule(
  analysis: HarmonyAnalysis,
  ruleId:
    | "chord.unclassified-nonchord-tone"
    | "chord.incomplete-members"
    | "chord.inversion-bass"
    | "chord.doubled-leading-tone"
    | "chord.doubled-seventh"
    | "chord.doubled-altered-tendency-tone"
    | "chord.dominant-ninth-voicing"
    | "chord.dominant-ninth-root-spacing"
    | "chord.augmented-sixth-voicing",
  config: RuleConfig = {},
) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.slices.forEach((slice, sliceIndex) => {
    const chord = slice.chord;
    if (!chord) return;
    const specializedVoicingRule =
      ruleId === "chord.dominant-ninth-voicing" ||
      ruleId === "chord.dominant-ninth-root-spacing" ||
      ruleId === "chord.augmented-sixth-voicing" ||
      ruleId === "chord.doubled-altered-tendency-tone";
    if (!specializedVoicingRule && !supportsTertianResolutionRules(chord))
      return;
    const active = activeNotes(slice);
    const tones = chordIdentityToneSpellings(chord.identity);
    const intermediate = finalSameHarmonySlice(analysis, sliceIndex);

    if (ruleId === "chord.unclassified-nonchord-tone") {
      const outside = active.filter(
        ({ note }) => !note.nonChordToneRole && !hasExactPitch(note, tones),
      );
      if (outside.length > 0) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            outside.map((item) => item.voiceId),
            outside.map((item) => item.note),
            "和弦外音需要确认",
            `标注和弦 ${chordLabel(chord)} 中存在拼写不属于和弦构成音、且未人工标注角色的音符。`,
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                ...outside.map((item) => noteEvidence(item.note)),
              ],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord.inversion-bass") {
      const bass = active.find((item) => item.voiceId === "bass");
      if (bass && !pitchClassEquals(bass.note.pitch, chord.identity.bass)) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            ["bass"],
            [bass.note],
            "低音与转位不一致",
            `${chordLabel(chord)} 要求低音写作 ${formatPitchClass(chord.identity.bass)}，当前为 ${formatPitchClass(bass.note.pitch)}。`,
            {
              chordIds: [chord.id],
              evidence: [
                chordEvidence(chord),
                noteEvidence(bass.note, "男低音"),
              ],
            },
          ),
        );
      }
      return;
    }

    if (!slice.completeSatb || intermediate) return;

    const isDominantNinth =
      chord.identity.structure.kind === "tertian" &&
      chord.identity.structure.quality === "dominant7" &&
      chord.identity.structure.extensions.includes(9);

    if (ruleId === "chord.doubled-altered-tendency-tone") {
      if (chord.identity.structure.kind !== "tertian") return;
      const directionalTones: Array<{
        tone: SpelledPitchClass;
        tendency: "up" | "down";
        degree: number;
      }> = [];
      chord.identity.structure.alterations.forEach((alteration) => {
        if (!alteration.tendency) return;
        const tone = chordIdentityToneSpellingForDegree(
          chord.identity,
          alteration.degree,
        );
        if (!tone) return;
        directionalTones.push({
          tone,
          tendency: alteration.tendency,
          degree: alteration.degree,
        });
      });
      const interpretation = chord.semantics
        ? primaryHarmonyInterpretation(chord.semantics)
        : undefined;
      const designationKind = interpretation?.designation?.kind;
      const targetDegree =
        interpretation?.appliedTarget?.degree ??
        (designationKind === "double-dominant" ||
        designationKind === "double-dominant-leading-tone"
          ? 5
          : undefined);
      if (targetDegree) {
        const targetTonic = scaleDegreePitchClass(slice.key, targetDegree, 0);
        const targetLeadingTone = scaleDegreePitchClass(
          { tonic: targetTonic, mode: "major" },
          7,
          0,
        );
        if (
          chordIdentityToneSpellings(chord.identity).some((tone) =>
            pitchClassEquals(tone, targetLeadingTone),
          ) &&
          !directionalTones.some(({ tone }) =>
            pitchClassEquals(tone, targetLeadingTone),
          )
        ) {
          directionalTones.push({
            tone: targetLeadingTone,
            tendency: "up",
            degree: 7,
          });
        }
      }
      directionalTones.forEach(({ tone, tendency, degree }) => {
        const repeated = active.filter(({ note }) =>
          pitchClassEquals(note.pitch, tone),
        );
        if (repeated.length <= 1) return;
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "重复变化倾向音",
            `${chordLabel(chord)} 的 ${formatPitchClass(tone)} 具有明确的${tendency === "up" ? "上行" : "下行"}倾向，不应重复。`,
            {
              chordIds: [chord.id],
              params: {
                degree,
                tendency,
                count: repeated.length,
              },
              evidence: [
                chordEvidence(chord),
                ...repeated.map(({ note }) =>
                  noteEvidence(note, "重复变化倾向音"),
                ),
              ],
            },
          ),
        );
      });
      return;
    }
    if (
      (ruleId === "chord.dominant-ninth-voicing" ||
        ruleId === "chord.dominant-ninth-root-spacing") &&
      !isDominantNinth
    )
      return;

    if (ruleId === "chord.dominant-ninth-voicing") {
      const tones = chordIdentityToneSpellings(chord.identity);
      const counts = tones.map(
        (tone) =>
          active.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length,
      );
      const required = chordVoicingPolicy(chord.identity).requiredDegrees;
      const missing = required
        .map((degree) => {
          const index = degree === 1 ? 0 : degree === 3 ? 1 : degree === 5 ? 2 : degree === 7 ? 3 : 4;
          return counts[index] === 0 ? tones[index] : undefined;
        })
        .filter((tone): tone is SpelledPitchClass => Boolean(tone));
      const fifthPresent = counts[2] > 0;
      if (missing.length > 0 || fifthPresent) {
        const problems = [
          ...(missing.length > 0
            ? [`缺少 ${missing.map(formatPitchClass).join("、")}`]
            : []),
          ...(fifthPresent ? ["不应出现五音"] : []),
        ];
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "属九和弦配置不符合四声部要求",
            `${chordLabel(chord)} ${problems.join("，")}。四声部 D9 默认采用 1/3/7/9。`,
            {
              chordIds: [chord.id],
              params: {
                missing: missing.map(formatPitchClass).join(","),
                fifthPresent,
              },
              evidence: [chordEvidence(chord)],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord.augmented-sixth-voicing") {
      if (chord.identity.structure.kind !== "augmented-sixth") return;
      const expected =
        chord.identity.structure.variant === "italian"
          ? [1, 2, 1]
          : [1, 1, 1, 1];
      const counts = tones.map(
        (tone) =>
          active.filter(({ note }) => pitchClassEquals(note.pitch, tone)).length,
      );
      if (counts.every((count, index) => count === expected[index])) return;
      const variantLabel =
        chord.identity.structure.variant === "italian"
          ? "It+6"
          : chord.identity.structure.variant === "french"
            ? "Fr+6"
            : "Ger+6";
      diagnostics.push(
        diagnostic(
          ruleId,
          slice.tick,
          slice.endTick,
          [],
          [],
          "增六和弦配置不正确",
          `${variantLabel} 应按 ${expected.join("/")} 配置 ${tones.map(formatPitchClass).join("、")}；增六两端变化音必须各出现一次。`,
          {
            chordIds: [chord.id],
            params: {
              variant: variantLabel,
              expected: expected.join("/"),
              actual: counts.join("/"),
            },
            evidence: [
              chordEvidence(chord),
              ...active.map(({ note }) => noteEvidence(note, "当前配置")),
            ],
          },
        ),
      );
      return;
    }

    if (ruleId === "chord.dominant-ninth-root-spacing") {
      const tones = chordIdentityToneSpellings(chord.identity);
      const root = active.find(
        ({ voiceId, note }) =>
          voiceId === "bass" && pitchClassEquals(note.pitch, tones[0]),
      );
      const ninth = active.find(({ note }) =>
        pitchClassEquals(note.pitch, tones[4]),
      );
      const minimumSemitones = 12;
      if (
        root &&
        ninth &&
        toMidi(ninth.note.pitch) - toMidi(root.note.pitch) <= minimumSemitones
      ) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            ["bass"],
            [root.note, ninth.note],
            "属九和弦根音与九音间距不足",
            `${chordLabel(chord)} 的九音必须位于根音上方超过八度。`,
            {
              chordIds: [chord.id],
              params: {
                distance: toMidi(ninth.note.pitch) - toMidi(root.note.pitch),
                minimumSemitones,
              },
              evidence: [
                chordEvidence(chord),
                noteEvidence(root.note, "根音"),
                noteEvidence(ninth.note, "九音"),
              ],
            },
          ),
        );
      }
      return;
    }

    if (ruleId === "chord.incomplete-members") {
      const missing = tones.filter(
        (tone) =>
          !active.some(({ note }) => pitchClassEquals(note.pitch, tone)),
      );
      if (missing.length > 0) {
        diagnostics.push(
          diagnostic(
            ruleId,
            slice.tick,
            slice.endTick,
            [],
            [],
            "和弦构成音不完整",
            `${chordLabel(chord)} 缺少 ${missing.map(formatPitchClass).join("、")}。`,
            {
              chordIds: [chord.id],
              params: { missing: missing.map(formatPitchClass).join(",") },
              evidence: [
                chordEvidence(chord),
                {
                  kind: "chord",
                  id: chord.id,
                  label: "缺少构成音",
                  value: missing.map(formatPitchClass).join("、"),
                },
              ],
            },
          ),
        );
      }
      return;
    }

    const target =
      ruleId === "chord.doubled-leading-tone"
        ? scaleDegreePitchClass(
            slice.key,
            7,
            slice.key.mode === "minor" ? 1 : 0,
          )
        : tones.length === 4
          ? tones[3]
          : undefined;
    if (!target) return;
    const repeated = active.filter(({ note }) =>
      pitchClassEquals(note.pitch, target),
    );
    if (repeated.length <= 1) return;
    diagnostics.push(
      diagnostic(
        ruleId,
        slice.tick,
        slice.endTick,
        repeated.map((item) => item.voiceId),
        repeated.map((item) => item.note),
        ruleId === "chord.doubled-leading-tone" ? "重复导音" : "重复和弦七音",
        ruleId === "chord.doubled-leading-tone"
          ? `四部和声中通常不应重复局部调性内的书写导音 ${formatPitchClass(target)}。`
          : `${chordLabel(chord)} 的七音 ${formatPitchClass(target)} 不应重复。`,
        {
          chordIds: [chord.id],
          evidence: [
            chordEvidence(chord),
            ...repeated.map((item) => noteEvidence(item.note)),
          ],
        },
      ),
    );
  });
  return diagnostics;
}

/**
 * 正常调色盘和编辑命令会阻止语义与实体分叉；这里仍在规则层做一次防御检查，
 * 以覆盖迁移、外置工具或未经过命令层写入的工程数据。
 */
export function chordInterpretationIdentityRule(analysis: HarmonyAnalysis) {
  const diagnostics: RuleDiagnostic[] = [];
  analysis.project.chordTrack.regions.forEach((chord) => {
    if (!chord.semantics) return;
    const key = analysisKeyAtTick(analysis, chord.startTick);
    if (
      harmonySemanticsCompatibleWithIdentity(
        chord.identity,
        chord.semantics,
        key,
      )
    )
      return;
    const interpretation = primaryHarmonyInterpretation(chord.semantics);
    diagnostics.push(
      diagnostic(
        "chord.interpretation-identity-conflict",
        chord.startTick,
        chord.startTick + chord.durationTicks,
        [],
        [],
        "功能解释与和弦实体冲突",
        `${chordLabel(chord)} 的和声解释无法重新生成当前根音、结构或低音。`,
        {
          chordIds: [chord.id],
          params: {
            interpretationId: interpretation.id,
            degree: interpretation.degree,
          },
          evidence: [
            chordEvidence(chord),
            {
              kind: "function",
              label: "主要解释",
              value:
                interpretation.designation?.kind ??
                `第 ${interpretation.degree} 级`,
            },
          ],
        },
      ),
    );
  });
  return diagnostics;
}
