import { toMidi } from "../../pitch";
import { VOICE_ORDER } from "../../project";
import { materializeRuleTestProject, dematerializeRuleTestProject } from "./projectFixture";
import type {
  ExpectedDiagnostic,
  HarmonyRuleTestCase,
  RuleTestProjectFixture,
} from "./model";

function sortRecord<T>(value: Record<string, T>) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}

function canonicalExpectation(expectation: ExpectedDiagnostic) {
  const sortIds = (values: readonly string[] | undefined) =>
    values ? [...new Set(values)].sort((a, b) => a.localeCompare(b, "en")) : undefined;
  const voiceIds = expectation.voiceIds
    ? VOICE_ORDER.filter((voiceId) => expectation.voiceIds?.includes(voiceId))
    : undefined;
  return {
    ...expectation,
    ...(voiceIds ? { voiceIds } : {}),
    ...(expectation.noteIds ? { noteIds: sortIds(expectation.noteIds) } : {}),
    ...(expectation.chordIds
      ? { chordIds: sortIds(expectation.chordIds) }
      : {}),
    ...(expectation.params ? { params: sortRecord(expectation.params) } : {}),
  };
}

function canonicalFixture(
  fixture: RuleTestProjectFixture,
  title: string,
): RuleTestProjectFixture {
  const project = materializeRuleTestProject(fixture, title);
  project.tempoEvents.sort((left, right) =>
    left.tick - right.tick || left.id.localeCompare(right.id, "en"),
  );
  project.meterEvents.sort((left, right) =>
    left.tick - right.tick || left.id.localeCompare(right.id, "en"),
  );
  project.keyEvents.sort((left, right) =>
    left.tick - right.tick || left.id.localeCompare(right.id, "en"),
  );
  project.satbTracks.forEach((track) =>
    track.notes.sort(
      (left, right) =>
        left.startTick - right.startTick ||
        toMidi(left.pitch) - toMidi(right.pitch) ||
        left.id.localeCompare(right.id, "en"),
    ),
  );
  project.auxiliaryTracks.sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  project.auxiliaryTracks.forEach((track) =>
    track.notes.sort(
      (left, right) =>
        left.startTick - right.startTick ||
        toMidi(left.pitch) - toMidi(right.pitch) ||
        left.id.localeCompare(right.id, "en"),
    ),
  );
  project.chordTrack.regions.sort(
    (left, right) =>
      left.startTick - right.startTick || left.id.localeCompare(right.id, "en"),
  );
  return dematerializeRuleTestProject(project);
}

export function canonicalizeRuleTestCase(
  testCase: HarmonyRuleTestCase,
): HarmonyRuleTestCase {
  return {
    format: testCase.format,
    formatVersion: testCase.formatVersion,
    id: testCase.id,
    title: testCase.title,
    ...(testCase.description ? { description: testCase.description } : {}),
    tags: [...new Set(testCase.tags)].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    target: { ...testCase.target },
    execution: {
      ...testCase.execution,
      config: sortRecord(testCase.execution.config),
      exceptions: sortRecord(testCase.execution.exceptions),
    },
    project: canonicalFixture(testCase.project, testCase.title),
    expected: {
      diagnostics: testCase.expected.diagnostics
        .map(canonicalExpectation)
        .sort((left, right) => left.id.localeCompare(right.id, "en")),
      allowUnexpectedDiagnostics:
        testCase.expected.allowUnexpectedDiagnostics,
      skips: [...testCase.expected.skips].sort(
        (left, right) =>
          left.reason.localeCompare(right.reason, "en") ||
          Number(left.partial) - Number(right.partial),
      ),
    },
  };
}

export function serializeRuleTestCase(testCase: HarmonyRuleTestCase) {
  return `${JSON.stringify(canonicalizeRuleTestCase(testCase), null, 2)}\n`;
}
