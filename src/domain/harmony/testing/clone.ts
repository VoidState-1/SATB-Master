import { createId } from "../../project";
import type {
  ChordRegion,
  HarmonySemantics,
} from "../../project";
import type {
  ExpectedDiagnostic,
  HarmonyRuleTestCase,
  RuleTestProjectFixture,
} from "./model";

type IdMap = Map<string, string>;

function copyIdMap<T extends { id: string }>(
  values: readonly T[],
  prefix: string,
): { values: T[]; ids: IdMap } {
  const ids = new Map<string, string>();
  return {
    ids,
    values: values.map((value) => {
      const id = createId(prefix);
      ids.set(value.id, id);
      return { ...structuredClone(value), id };
    }),
  };
}

function remapSemantics(
  semantics: HarmonySemantics | undefined,
  interpretationIds: IdMap,
) {
  if (!semantics) return undefined;
  const remap = (interpretation: HarmonySemantics["interpretations"][number]) => ({
    ...structuredClone(interpretation),
    id: interpretationIds.get(interpretation.id) ?? createId("interpretation"),
  });
  const interpretations = semantics.interpretations.map(remap);
  const alternatives = semantics.alternatives?.map(remap);
  const primaryInterpretationId =
    interpretationIds.get(semantics.primaryInterpretationId) ??
    interpretations[0]?.id;
  if (!primaryInterpretationId) return undefined;
  return {
    ...structuredClone(semantics),
    interpretations,
    ...(alternatives ? { alternatives } : {}),
    primaryInterpretationId,
  };
}

function remapChordRegions(
  regions: readonly ChordRegion[],
  chordIds: IdMap,
  interpretationIds: IdMap,
) {
  return regions.map((region) => ({
    ...structuredClone(region),
    id: chordIds.get(region.id) ?? createId("chord"),
    semantics: remapSemantics(region.semantics, interpretationIds),
  }));
}

function cloneFixture(fixture: RuleTestProjectFixture) {
  const source = structuredClone(fixture);
  const tempo = copyIdMap(source.tempoEvents, "tempo");
  const meter = copyIdMap(source.meterEvents, "meter");
  const key = copyIdMap(source.keyEvents, "key");
  const notes = new Map<string, string>();
  const copyTrackNotes = (track: (typeof source.satbTracks)[number]) => {
    const noteCopies = copyIdMap(track.notes, "note");
    noteCopies.ids.forEach((value, id) => notes.set(id, value));
    return { ...structuredClone(track), notes: noteCopies.values };
  };
  const satbTracks = source.satbTracks.map(copyTrackNotes);
  const auxiliaryTracks = source.auxiliaryTracks.map((track) => {
    const noteCopies = copyIdMap(track.notes, "note");
    noteCopies.ids.forEach((value, id) => notes.set(id, value));
    return { ...structuredClone(track), notes: noteCopies.values };
  });
  const chordIds = copyIdMap(source.chordTrack.regions, "chord");
  const interpretationIds = new Map<string, string>();
  source.chordTrack.regions.forEach((region) => {
    const semantics = region.semantics;
    [...(semantics?.interpretations ?? []), ...(semantics?.alternatives ?? [])].forEach(
      (interpretation) => {
        interpretationIds.set(interpretation.id, createId("interpretation"));
      },
    );
  });
  const chordRegions = remapChordRegions(
    source.chordTrack.regions,
    chordIds.ids,
    interpretationIds,
  );
  return {
    fixture: {
      ...source,
      tempoEvents: tempo.values,
      meterEvents: meter.values,
      keyEvents: key.values,
      satbTracks,
      auxiliaryTracks,
      chordTrack: {
        ...source.chordTrack,
        regions: chordRegions,
      },
    },
    noteIds: notes,
    chordIds: chordIds.ids,
  };
}

function remapExpectation(
  expectation: ExpectedDiagnostic,
  expectationId: string,
  noteIds: IdMap,
  chordIds: IdMap,
) {
  return {
    ...structuredClone(expectation),
    id: expectationId,
    noteIds: expectation.noteIds?.map((id) => noteIds.get(id) ?? id),
    chordIds: expectation.chordIds?.map((id) => chordIds.get(id) ?? id),
  };
}

export interface CloneRuleTestCaseOptions {
  id?: string;
  title?: string;
}

export function cloneRuleTestCase(
  testCase: HarmonyRuleTestCase,
  options: CloneRuleTestCaseOptions = {},
): HarmonyRuleTestCase {
  const clone = cloneFixture(testCase.project);
  const expectationIds = new Map(
    testCase.expected.diagnostics.map((expectation) => [
      expectation.id,
      createId("expected"),
    ]),
  );
  return {
    ...structuredClone(testCase),
    id: options.id ?? createId("case"),
    title: (options.title ?? `${testCase.title}（副本）`).slice(0, 120),
    project: clone.fixture,
    expected: {
      ...structuredClone(testCase.expected),
      diagnostics: testCase.expected.diagnostics.map((expectation) =>
        remapExpectation(
          expectation,
          expectationIds.get(expectation.id) ?? createId("expected"),
          clone.noteIds,
          clone.chordIds,
        ),
      ),
    },
  };
}
