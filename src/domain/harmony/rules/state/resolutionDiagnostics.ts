import { chordIdentityToneSpellings } from "../../../chordModel";
import { formatPitchClass, toMidi } from "../../../pitch";
import type { AnalysisNote } from "../../analysis";
import type { DiagnosticEvidence, RuleDiagnostic } from "../../runtime";
import { chordEvidence, chordLabel, diagnostic, noteEvidence } from "../helpers/core";
import { mergeDiagnosticEvidence, obligationDiagnosticContext, type ObligationDecision, type ObligationEnvironment } from "./obligation";
import type { AlteredTonePayload, DominantNinthPayload, LeadingTonePayload, SeventhPayload, VoiceObligationPayload } from "./tendency";
import { currentSpanId, openedSourceChord, openedSourceNote, openedSpanId } from "./tendencyContext";
import { dominantNinthTone } from "../../facts/dominantMotion";

interface ResolutionReport {
  ruleId: "resolution.leading-tone" | "resolution.chord-seventh" | "resolution.dominant-ninth" | "resolution.altered-tone";
  source: AnalysisNote;
  current: AnalysisNote;
  title: string;
  message: string;
  params: NonNullable<RuleDiagnostic["params"]>;
  chordIds?: string[];
  evidence: DiagnosticEvidence[];
}

function reportResolution<Payload extends VoiceObligationPayload>(
  environment: ObligationEnvironment<Payload>,
  decision: ObligationDecision,
  report: ResolutionReport,
) {
  const { ruleId, current, source } = report;
  const voiceId = environment.obligation.payload.voiceId;
  const sourceSpanId = openedSpanId(environment);
  const targetSpanId = currentSpanId(environment);
  const connection = sourceSpanId && targetSpanId
    ? environment.context.rules.connections({ sourceSpanId, targetSpanId }).first()?.connection
    : undefined;
  const connectionKey = connection?.connectionKey ?? `connection:${sourceSpanId ?? "none"}->${targetSpanId ?? "none"}`;
  const { subjects, trace, evidence } = obligationDiagnosticContext(environment, decision);
  return diagnostic(ruleId, current.startTick, current.startTick + current.durationTicks,
    [voiceId], [source, current], report.title, report.message, {
      chordIds: report.chordIds,
      params: report.params,
      evidence: mergeDiagnosticEvidence(report.evidence, evidence),
      causeRefs: [`${ruleId}|${connectionKey}|voice:${voiceId}`],
      subjects,
      trace,
    });
}

export function leadingToneDiagnostic(
  environment: ObligationEnvironment<LeadingTonePayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const source = openedSourceNote(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  if (!source || !current) return undefined;
  const leadingTone = {
    step: payload.leadingStep,
    alter: payload.leadingAlter,
  };
  const targetTonic = {
    step: payload.targetStep,
    alter: payload.targetAlter,
  };
  const targetKeyName = `${formatPitchClass(targetTonic)} ${payload.targetMode}`;
  return reportResolution(environment, decision, {
    ruleId: "resolution.leading-tone",
    source,
    current,
    title: "导音未上行解决",
    message: `书写导音 ${formatPitchClass(leadingTone)} 通常应上行半音解决到主音。`,
    params: {
      key: targetKeyName,
      leadingTone: formatPitchClass(leadingTone),
      targetTonic: formatPitchClass(targetTonic),
    },
    evidence: [
      noteEvidence(source, "导音"),
      noteEvidence(current, "后继音"),
      {
        kind: "key",
        id: openedSourceChord(environment)?.id ?? environment.context.slice.key.id,
        label: "局部调性",
        value: targetKeyName,
      },
    ],
  });
}

export function seventhDiagnostic(
  environment: ObligationEnvironment<SeventhPayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const source = openedSourceNote(environment);
  const chord = openedSourceChord(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  const targetChord = environment.context.slice.chord;
  const writtenSixFour = decision.reason === "supertonic-seventh-leaps-to-six-four";
  if (!source || !chord || !current || (!targetChord && !writtenSixFour)) return undefined;
  const tones = chordIdentityToneSpellings(chord.identity);
  const resolution = toMidi(current.pitch) - payload.seventhMidi;
  let title = "七音未级进下行解决";
  let message = `书写七音 ${formatPitchClass(tones[3])} 通常应以半音或全音级进下行解决。`;
  if (writtenSixFour) {
    title = "下属七和弦的七音上行三度";
    message = "进入属低音上的主四六音组时，原声部七音上行了三度。终止四六要求保持七音，经过主四六也不能这样跳进。";
  } else if (decision.reason === "chord-seventh-bass-rises-to-root") {
    title = "属七和弦换位时低音七音上行";
    message = "属二和弦换为同一属七和弦原位时，低音七音不可级进上行到根音。";
  } else if (decision.reason === "supertonic-seventh-exchanges-with-root") {
    title = "下属七和弦的七音与根音互换";
    message = "Ⅱ级七和弦重新排列时，七音上行到根音，同时原根音下行接走七音。此处应避免两音互换。";
  } else if (decision.reason === "chord-seventh-upper-root-exchange") {
    title = "属七和弦换位时根音与七音互换";
    message = "原七音上行到根音，原根音下行接走七音。此处宜在原声部保持七音。";
  } else if (decision.reason === "chord-seventh-upper-tritone-transfer") {
    title = "属七和弦换位时七音移至根音";
    message = "原七音移至根音，接手的声部又从三音下行增四度至七音。此处宜在原声部保持七音。";
  }
  return reportResolution(environment, decision, {
    ruleId: "resolution.chord-seventh",
    source,
    current,
    title,
    message,
    chordIds: targetChord ? [chord.id, targetChord.id] : [chord.id],
    params: {
      resolutionSemitones: resolution,
      ...(targetChord && { targetChord: chordLabel(targetChord) }),
    },
    evidence: [
      chordEvidence(chord),
      noteEvidence(source, "和弦七音"),
      ...(targetChord ? [chordEvidence(targetChord)] : Object.values(environment.context.slice.notes)
        .map(note => noteEvidence(note, "实写四六音组"))),
      noteEvidence(current, "后继音"),
    ],
  });
}

export function dominantNinthDiagnostic(
  environment: ObligationEnvironment<DominantNinthPayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const source = openedSourceNote(environment);
  const sourceChord = openedSourceChord(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  const targetChord = environment.context.slice.chord;
  if (!source || !sourceChord || !current || !targetChord) return undefined;
  const ninth = dominantNinthTone(sourceChord.identity);
  if (!ninth) return undefined;
  const resolution = toMidi(current.pitch) - payload.ninthMidi;
  return reportResolution(environment, decision, {
    ruleId: "resolution.dominant-ninth",
    source,
    current,
    title: "属九音未级进下行解决",
    message: `${chordLabel(sourceChord)} 的九音 ${formatPitchClass(ninth)} 未按书写下行解决到目标和弦。`,
    chordIds: [sourceChord.id, targetChord.id],
    params: {
      resolutionSemitones: resolution,
      targetChord: chordLabel(targetChord),
    },
    evidence: [
      chordEvidence(sourceChord),
      noteEvidence(source, "属九音"),
      chordEvidence(targetChord),
      noteEvidence(current, "后继音"),
    ],
  });
}

export function alteredToneDiagnostic(
  environment: ObligationEnvironment<AlteredTonePayload>,
  decision: ObligationDecision,
) {
  const payload = environment.obligation.payload;
  const source = openedSourceNote(environment);
  const sourceChord = openedSourceChord(environment);
  const current = environment.context.slice.notes[payload.voiceId];
  const targetChord = environment.context.slice.chord;
  if (!source || !sourceChord || !current || !targetChord) return undefined;
  const actualSemitones = toMidi(current.pitch) - payload.alteredMidi;
  return reportResolution(environment, decision, {
    ruleId: "resolution.altered-tone",
    source,
    current,
    title: "变化倾向音未按标注方向解决",
    message: `${chordLabel(sourceChord)} 的变化构成音已标注为${payload.tendency === "up" ? "上行" : "下行"}倾向，应以半音解决到目标和弦音。`,
    chordIds: [sourceChord.id, targetChord.id],
    params: {
      degree: payload.degree,
      tendency: payload.tendency,
      actualSemitones,
    },
    evidence: [
      chordEvidence(sourceChord),
      noteEvidence(source, "变化倾向音"),
      chordEvidence(targetChord),
      noteEvidence(current, "后继音"),
    ],
  });
}
