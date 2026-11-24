import {
  chordIdentityEquals,
  chordIdentityKeyWithoutBass,
  harmonySemanticsCompatibleWithIdentity,
  semanticsFromChordDraft,
  type ChordIdentity,
  type HarmonySemantics,
  type ScaleDegree,
} from "../../chordModel";
import { formatChordIdentity } from "../../chords";
import {
  formatSpelledPitch, keyEquals, scaleDegreePitchClass, serializePitchClass,
  serializeSpelledPitch, spelledPitchEquals, stepIndex, toMidi, type Alteration, type SpelledPitch,
} from "../../pitch";
import { createId } from "../../project/defaults";
import type { ChordRegion, NoteEvent, ProjectDocument, VoiceId } from "../../project/types";
import { validateProject } from "../../project/validation";
import { VOICE_ORDER } from "../../project/voice";
import { buildMetricTimeline, metricPositionAt } from "../../rhythm/metric";
import { eventAtTick, measureAtTick, orderedEvents, ticksPerBeat } from "../../time";
import { inferChords } from "../inference/pipeline";
import { checkHarmony } from "../registry";
import type { MelodySlice } from "./melodyGrid";
import { bassStep, isDeceptive, scoreChoice, scoreTransition, type Choice, type Obligations, type TransitionState } from "./transitionCost";
import type { HarmonizationGivenVoice, HarmonizationRange, HarmonizationRelaxedLevel, HarmonizationStyle } from "./types";
import { clip, reconcileCadences, replaceRange } from "./verifyAndApply";
import {
  buildVocabulary, chromaticVocabulary, enumerateVoicings, lockedVocabulary, voicingFromPitches,
  type HarmonizationChord, type VoicedNotes,
} from "./vocabulary";

export type { Obligations } from "./transitionCost";
export type { VoicedNotes } from "./vocabulary";

export type ProgressionSearchMode = "single" | "short";
export type ProgressionShortLength = 2 | 3 | 4 | "bridge";
export type ProgressionStepPreset = "beat" | "half-bar" | "grid";

export interface ProgressionSearchOptions {
  fromTick: number;
  mode: ProgressionSearchMode;
  shortLength?: ProgressionShortLength;
  stepTicks?: number;
  /** Empty-slot length in local meter beats when stepTicks is omitted. */
  stepBeats?: 1 | 2;
  style?: HarmonizationStyle;
  maxCandidates?: number;
  respectLockedChords?: boolean;
}

type Anchor = HarmonizationRange & { voicing?: VoicedNotes; chordLabel?: string };

export interface OpenSlotContext extends HarmonizationRange {
  kind: "empty" | "partial";
  spanEndTick?: number;
  fixedVoices: Partial<Record<VoiceId, SpelledPitch>>;
  leftAnchor?: Anchor & { obligations: Obligations };
  rightAnchor?: Anchor & { distanceSteps?: number };
}

export interface ProgressionStep extends HarmonizationRange {
  chord: { label: string; identity: ChordIdentity; semantics: HarmonySemantics };
  notes: Record<VoiceId, SpelledPitch>;
  generatedVoices: readonly VoiceId[];
}

interface DiagnosticSummary {
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
}

export interface ProgressionVoicingVariant {
  id: string;
  label: string;
  steps: readonly ProgressionStep[];
  diagnosticSummary: DiagnosticSummary;
  score: number;
  previewProject: ProjectDocument;
}

export interface ProgressionCandidate extends HarmonizationRange {
  id: string;
  mode: ProgressionSearchMode;
  headline: string;
  tag?: string;
  steps: readonly ProgressionStep[];
  variants: readonly ProgressionVoicingVariant[];
  diagnosticSummary: DiagnosticSummary;
  score: number;
  relaxedLevel: HarmonizationRelaxedLevel;
  previewProject: ProjectDocument;
  /** Ticks in the rebased preview project. Candidate and step ticks refer to the source. */
  previewRange: HarmonizationRange;
}

export interface ProgressionSearchResult {
  slot?: OpenSlotContext;
  candidates: readonly ProgressionCandidate[];
  warnings: readonly string[];
  elapsedMs: number;
}

type FixedNotes = Partial<Record<VoiceId, NoteEvent>>;
interface OpenSlice extends HarmonizationRange {
  notes: FixedNotes;
  lockedChord?: ChordRegion;
}
interface AnchorState {
  range: HarmonizationRange;
  slice: MelodySlice;
  state?: TransitionState;
  chordLabel?: string;
}

const endOf = (item: { startTick: number; durationTicks: number }) => item.startTick + item.durationTicks;
const overlaps = (item: { startTick: number; durationTicks: number }, range: HarmonizationRange) =>
  item.startTick < range.toTick && endOf(item) > range.fromTick;
const fixedPitches = (notes: FixedNotes) => Object.fromEntries(
  VOICE_ORDER.flatMap(voice => notes[voice] ? [[voice, notes[voice].pitch]] : []),
) as Partial<Record<VoiceId, SpelledPitch>>;

function completePitches(notes: FixedNotes): Record<VoiceId, SpelledPitch> | undefined {
  const pitches = fixedPitches(notes);
  return VOICE_ORDER.every(voice => pitches[voice]) ? pitches as Record<VoiceId, SpelledPitch> : undefined;
}

function upperBound<T>(items: readonly T[], tick: number, time: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (time(items[middle]) <= tick) low = middle + 1;
    else high = middle;
  }
  return low;
}

function timelineFor(project: ProjectDocument) {
  const tracks = project.satbTracks.map(track => {
    const notes = [...track.notes].sort((a, b) => a.startTick - b.startTick);
    // A prefix end lets lookup handle overlapping source events as well as ordinary monophonic tracks.
    let latestEnd = 0;
    const ends = notes.map(note => latestEnd = Math.max(latestEnd, endOf(note)));
    return { voice: track.id, notes, ends };
  });
  const noteTicks = [...new Set([0, project.lengthTicks,
    ...tracks.flatMap(track => track.notes.flatMap(note => [note.startTick, endOf(note)])),
  ])].sort((a, b) => a - b);
  const regions = [...project.chordTrack.regions].sort((a, b) => a.startTick - b.startTick);
  const keyEvents = orderedEvents(project.keyEvents);
  const meterEvents = orderedEvents(project.meterEvents);
  const metric = buildMetricTimeline({ ...project, meterEvents });
  const anchorTicks = [...new Set([...noteTicks, ...keyEvents.map(key => key.tick),
    ...regions.flatMap(region => [region.startTick, endOf(region)]),
  ])].sort((a, b) => a - b);
  return {
    project, regions, keyEvents, meterEvents, metric, noteTicks, anchorTicks,
    notesAt(tick: number) {
      const result: FixedNotes = {};
      for (const { voice, notes, ends } of tracks) {
        for (let i = upperBound(notes, tick, note => note.startTick) - 1; i >= 0 && ends[i] > tick; i--) {
          if (endOf(notes[i]) <= tick) continue;
          result[voice] = notes[i];
          break;
        }
      }
      return result;
    },
    chordAt(tick: number) {
      const chord = regions[upperBound(regions, tick, region => region.startTick) - 1];
      return chord && endOf(chord) > tick ? chord : undefined;
    },
    keyAt: (tick: number) => eventAtTick(keyEvents, tick),
    beatAt: (tick: number) => ticksPerBeat(project.ppq, eventAtTick(meterEvents, tick).denominator),
  };
}

type Timeline = ReturnType<typeof timelineFor>;

function stepLength(timeline: Timeline, tick: number, stepTicks?: number, stepBeats = 1) {
  return stepTicks !== undefined && Number.isFinite(stepTicks) && stepTicks > 0
    ? Math.max(1, Math.round(stepTicks)) : timeline.beatAt(tick) * stepBeats;
}

function openSliceAt(timeline: Timeline, fromTick: number, stepTicks?: number, stepBeats?: number): OpenSlice | undefined {
  if (fromTick >= timeline.project.lengthTicks) return undefined;
  const notes = timeline.notesAt(fromTick);
  const count = Object.keys(notes).length;
  if (count === VOICE_ORDER.length) return undefined;
  const nextChange = timeline.noteTicks[upperBound(timeline.noteTicks, fromTick, tick => tick)];
  const toTick = count ? nextChange : Math.min(nextChange, fromTick + stepLength(timeline, fromTick, stepTicks, stepBeats));
  return { fromTick, toTick, notes };
}

function firstOpenSlice(timeline: Timeline, fromTick: number, stepTicks?: number, stepBeats?: number) {
  if (!Number.isFinite(fromTick)) return undefined;
  const start = Math.max(0, Math.floor(fromTick));
  const initial = openSliceAt(timeline, start, stepTicks, stepBeats);
  if (initial) return initial;
  // Beat-grid boundaries within a fully voiced slice cannot change its occupancy.
  for (let i = upperBound(timeline.noteTicks, start, tick => tick); i < timeline.noteTicks.length; i++) {
    const slice = openSliceAt(timeline, timeline.noteTicks[i], stepTicks, stepBeats);
    if (slice) return slice;
  }
  return undefined;
}

function eventsWithin<T extends { tick: number }>(events: readonly T[], origin: number, end: number): T[] {
  return [
    { ...eventAtTick(events, origin), tick: 0 },
    ...events.filter(event => event.tick > origin && event.tick < end)
      .map(event => ({ ...event, tick: event.tick - origin })),
  ];
}

function chordWithOriginalKey(region: ChordRegion, originalKey: MelodySlice["key"], newKey: MelodySlice["key"]) {
  const { semantics, identity } = region;
  if (!semantics || harmonySemanticsCompatibleWithIdentity(identity, semantics, newKey)) return region;
  // Keep the written identity when a clipped chord is restarted after a key change.
  const localKey = { tonic: originalKey.tonic, mode: originalKey.mode };
  return { ...region, semantics: {
    ...semantics,
    interpretations: semantics.interpretations.map(interpretation =>
      interpretation.localKey ? interpretation : { ...interpretation, localKey }),
  } };
}

function cropProject(timeline: Timeline, start: number, end: number) {
  const { project } = timeline;
  // Rebase from a barline so that the source accents used by the rules survive cropping.
  const origin = measureAtTick(timeline.metric.measures, start)?.startTick ?? start;
  const range = { fromTick: start, toTick: end };
  const length = end - origin;
  const crop = <T extends { id: string; startTick: number; durationTicks: number }>(item: T) =>
    clip(item, Math.max(item.startTick, start) - origin, Math.min(endOf(item), end) - origin);
  const result: ProjectDocument = {
    ...project,
    lengthTicks: length,
    tempoEvents: eventsWithin(orderedEvents(project.tempoEvents), origin, end),
    meterEvents: eventsWithin(timeline.meterEvents, origin, end),
    keyEvents: eventsWithin(timeline.keyEvents, origin, end),
    satbTracks: project.satbTracks.map(track => ({
      ...track,
      notes: track.notes.filter(note => overlaps(note, range)).map(crop),
    })),
    auxiliaryTracks: [],
    structure: {
      phraseBoundaries: project.structure.phraseBoundaries
        .filter(boundary => boundary.tick > start && boundary.tick < end)
        .map(boundary => ({ ...boundary, tick: boundary.tick - origin })),
    },
    chordTrack: {
      ...project.chordTrack,
      regions: timeline.regions.filter(chord => overlaps(chord, range)).map(chord =>
        chordWithOriginalKey(crop(chord), timeline.keyAt(chord.startTick), timeline.keyAt(Math.max(start, chord.startTick)))),
      cadenceAnnotations: project.chordTrack.cadenceAnnotations
        .filter(annotation => annotation.fromTick >= start && annotation.toTick <= end)
        .map(annotation => ({
          ...annotation, fromTick: annotation.fromTick - origin, toTick: annotation.toTick - origin,
          observedLandingTick: annotation.observedLandingTick === undefined
            ? undefined : annotation.observedLandingTick - origin,
        })),
    },
    loop: { enabled: false, startTick: 0, endTick: length },
    exercise: { ...project.exercise, editableRanges: [] },
    diagnosticPreferences: { ignoredDiagnosticIds: [] },
  };
  return { origin, project: result };
}

function labelFor(chord: HarmonizationChord, key: MelodySlice["key"]) {
  if (chord.role === "cadential64") return "K46";
  const name = formatChordIdentity(chord.identity, chord.semantics, key.mode);
  return chord.semantics ? name.roman : name.absolute;
}

function semanticChord(region: ChordRegion, key: MelodySlice["key"]) {
  if (region.semantics) return region;
  const known = buildVocabulary(key, "expressive-secondary")
    .find(chord => !chord.role && chordIdentityEquals(chord.identity, region.identity));
  if (known?.semantics) return { ...region, semantics: known.semantics };
  const { root, structure } = region.identity;
  const degree = ((stepIndex(root.step) - stepIndex(key.tonic.step) + 7) % 7 + 1) as ScaleDegree;
  const degreeAlteration = root.alter - scaleDegreePitchClass(key, degree).alter;
  if (degreeAlteration < -2 || degreeAlteration > 2) return region;
  const semantics = semanticsFromChordDraft({
    degree, degreeAlteration: degreeAlteration as Alteration, inversion: 0,
    quality: structure.kind === "tertian" ? structure.quality : "major",
    source: "inferred", confidence: "ambiguous",
  });
  return harmonySemanticsCompatibleWithIdentity(region.identity, semantics, key)
    ? { ...region, semantics } : region;
}

function asMelodySlice(timeline: Timeline, slice: OpenSlice): MelodySlice {
  const position = metricPositionAt(timeline.metric, slice.fromTick);
  const durationTicks = slice.toTick - slice.fromTick;
  const melody = slice.notes.soprano ?? slice.notes.bass ?? Object.values(slice.notes)[0] ?? {
    id: "progression-free", startTick: slice.fromTick, durationTicks,
    pitch: { ...timeline.keyAt(slice.fromTick).tonic, octave: 4 }, velocity: 78,
    locked: false, spellingSource: "manual",
  };
  return {
    tick: slice.fromTick, endTick: slice.toTick, durationTicks, melody,
    key: timeline.keyAt(slice.fromTick), metricLevel: position?.level ?? 0,
    measureNumber: position?.measureNumber ?? 1, beatLength: timeline.beatAt(slice.fromTick),
    lockedPitches: fixedPitches(slice.notes), lockedChord: slice.lockedChord,
    phraseStart: slice.fromTick === 0 || timeline.project.structure.phraseBoundaries
      .some(boundary => boundary.tick === slice.fromTick && !boundary.stale),
  };
}

function obligationsAfter(choice: Choice, slice: MelodySlice, previous?: TransitionState): Obligations {
  const before = previous?.choice;
  const sameChord = before?.chord.signature === choice.chord.signature;
  return {
    heldMetricLevel: sameChord && previous
      ? Math.max(previous.obligations.heldMetricLevel, slice.metricLevel) : slice.metricLevel,
    bassDirection: before && choice.chord.role === "passing64"
      ? sameChord ? previous.obligations.bassDirection : bassStep(before, choice) : 0,
    pedalOrigin: choice.chord.role === "pedal64"
      ? sameChord ? previous?.obligations.pedalOrigin : before?.chord.signature : undefined,
    sopranoHeldTicks: slice.durationTicks + (previous &&
      spelledPitchEquals(previous.choice.voicing.notes[0].pitch, choice.voicing.notes[0].pitch)
      ? previous.obligations.sopranoHeldTicks : 0),
  };
}

function inferAnchorRegions(timeline: Timeline, fromTick: number, toTick: number) {
  const start = Math.max(0, fromTick - timeline.beatAt(fromTick));
  const end = Math.min(timeline.project.lengthTicks, toTick + timeline.beatAt(toTick));
  const { origin, project } = cropProject(timeline, start, end);
  const inference = inferChords(project, { allowCadentialTonicOmission: true });
  return inference.regions.flatMap(region => region.selected ? [{
    id: region.id, startTick: origin + region.fromTick, durationTicks: region.toTick - region.fromTick,
    identity: region.selected.identity, semantics: region.selected.semantics, locked: false,
  }] : []);
}

function anchorAt(timeline: Timeline, fromTick: number, toTick: number, left: boolean): AnchorState {
  const notes = timeline.notesAt(fromTick);
  const range = { fromTick, toTick };
  const slice = asMelodySlice(timeline, { ...range, notes });
  const pitches = completePitches(notes);
  const currentRegion = timeline.chordAt(fromTick);
  if (!pitches) {
    const chordLabel = currentRegion && labelFor(lockedVocabulary(currentRegion, slice.key), slice.key);
    return { range, slice, chordLabel };
  }

  const beforeTick = timeline.anchorTicks[upperBound(timeline.anchorTicks, fromTick - 1, tick => tick) - 1];
  const beforeRegion = beforeTick !== undefined ? timeline.chordAt(beforeTick) : undefined;
  const beforeNotes = left && beforeTick !== undefined ? timeline.notesAt(beforeTick) : {};
  const priorPitches = completePitches(beforeNotes);
  const inferred = !currentRegion || (!beforeRegion && priorPitches)
    ? inferAnchorRegions(timeline, left ? beforeTick ?? fromTick : fromTick, toTick) : [];
  const regionAt = (tick: number) => timeline.chordAt(tick) ??
    inferred.find(chord => chord.startTick <= tick && endOf(chord) > tick);
  const choiceAt = (tick: number, written: Record<VoiceId, SpelledPitch>, region?: ChordRegion): Choice | undefined => {
    const input = region ?? regionAt(tick);
    if (!input) return undefined;
    const key = timeline.keyAt(tick);
    const chord = lockedVocabulary(semanticChord(chordWithOriginalKey(input, timeline.keyAt(input.startTick), key), key), key);
    if (!input.locked) delete chord.locked;
    return { chord, voicing: voicingFromPitches(chord, written), score: 0 };
  };
  // An unclassified sonority still supplies the four written pitches at the seam.
  const choice = choiceAt(fromTick, pitches, currentRegion) ?? unclassifiedAnchor(pitches, slice.key);
  let previous: TransitionState | undefined;
  if (left && beforeTick !== undefined && priorPitches && keyEquals(timeline.keyAt(beforeTick), slice.key)) {
    const prior = choiceAt(beforeTick, priorPitches, beforeRegion);
    if (prior) {
      const priorSlice = asMelodySlice(timeline, { fromTick: beforeTick, toTick: fromTick, notes: beforeNotes });
      previous = { choice: prior, obligations: obligationsAfter(prior, priorSlice) };
    }
  }
  const obligations = obligationsAfter(choice, slice, previous);
  const onset = regionAt(fromTick)?.startTick ?? fromTick;
  if (left && onset < fromTick && keyEquals(timeline.keyAt(onset), slice.key)) {
    obligations.heldMetricLevel = Math.max(obligations.heldMetricLevel, metricPositionAt(timeline.metric, onset)?.level ?? 0);
    obligations.sopranoHeldTicks = Math.max(obligations.sopranoHeldTicks, toTick - notes.soprano!.startTick);
    if (onset && (choice.chord.role === "passing64" || choice.chord.role === "pedal64")) {
      const incoming = completePitches(timeline.notesAt(onset - 1));
      const atOnset = completePitches(timeline.notesAt(onset));
      const entry = incoming && choiceAt(onset - 1, incoming);
      if (entry && atOnset) {
        obligations.bassDirection = choice.chord.role === "passing64"
          ? bassStep(entry, { ...choice, voicing: voicingFromPitches(choice.chord, atOnset) }) : 0;
        if (choice.chord.role === "pedal64") obligations.pedalOrigin = entry.chord.signature;
      }
    }
  }
  return {
    range, slice, state: { choice, previous, obligations },
    chordLabel: currentRegion || choice.chord.semantics ? labelFor(choice.chord, slice.key) : undefined,
  };
}

function unclassifiedAnchor(pitches: Record<VoiceId, SpelledPitch>, key: MelodySlice["key"]): Choice {
  const chord = chromaticVocabulary(pitches.bass, key);
  return { chord, voicing: voicingFromPitches(chord, pitches), score: 0 };
}

function leftAnchorFor(timeline: Timeline, tick: number) {
  if (tick === 0) return undefined;
  const start = timeline.anchorTicks[upperBound(timeline.anchorTicks, tick - 1, time => time) - 1];
  return Object.keys(timeline.notesAt(start)).length ? anchorAt(timeline, start, tick, true) : undefined;
}

function nextSoundingTick(timeline: Timeline, tick: number) {
  if (tick >= timeline.project.lengthTicks) return undefined;
  if (Object.keys(timeline.notesAt(tick)).length) return tick;
  for (let i = upperBound(timeline.noteTicks, tick, time => time); i < timeline.noteTicks.length - 1; i++) {
    const next = timeline.noteTicks[i];
    if (Object.keys(timeline.notesAt(next)).length) return next;
  }
  return undefined;
}

function rightAnchorFor(timeline: Timeline, end: number) {
  const start = nextSoundingTick(timeline, end);
  if (start === undefined) return undefined;
  const toTick = timeline.anchorTicks[upperBound(timeline.anchorTicks, start, time => time)];
  return anchorAt(timeline, start, toTick, false);
}

function contextFor(first: OpenSlice, left: AnchorState | undefined, right: AnchorState | undefined, step: number): OpenSlotContext {
  const anchor = (item: AnchorState): Anchor => ({
    ...item.range, voicing: item.state?.choice.voicing.notes,
    chordLabel: item.chordLabel,
  });
  const choice = left?.state?.choice;
  const obligations = left?.state && { ...left.state.obligations };
  if (choice && obligations) {
    const { chord, voicing } = choice;
    if (chord.role === "cadential64") obligations.cadential64 = true;
    if (chord.tones.length === 4) obligations.seventhVoices = VOICE_ORDER.filter((_, i) => voicing.notes[i].tone === 3);
    if (chord.hasLeadingToneObligation) {
      obligations.leadingToneVoices = VOICE_ORDER.filter((_, i) => voicing.notes[i].leading && voicing.notes[i].tone >= 0);
    }
  }
  return {
    kind: Object.keys(first.notes).length ? "partial" : "empty",
    fromTick: first.fromTick, toTick: first.toTick, fixedVoices: fixedPitches(first.notes),
    leftAnchor: left && { ...anchor(left), obligations: obligations ??
      { heldMetricLevel: left.slice.metricLevel, bassDirection: 0, sopranoHeldTicks: 0 } },
    rightAnchor: right && { ...anchor(right), distanceSteps: Math.ceil((right.range.fromTick - first.fromTick) / step) },
  };
}

export function findNextOpenSlot(project: ProjectDocument, fromTick: number, stepTicks?: number): OpenSlotContext | undefined {
  const timeline = timelineFor(project);
  const first = firstOpenSlice(timeline, fromTick, stepTicks);
  if (!first) return undefined;
  return structuredClone(contextFor(first, leftAnchorFor(timeline, first.fromTick),
    rightAnchorFor(timeline, first.toTick), stepLength(timeline, first.fromTick, stepTicks)));
}

function searchSliceAt(timeline: Timeline, tick: number, stepTicks: number, respectLocks: boolean) {
  const slice = openSliceAt(timeline, tick, stepTicks);
  if (!slice) return undefined;
  const nextKey = timeline.keyEvents[upperBound(timeline.keyEvents, tick, key => key.tick)];
  const activeChord = timeline.chordAt(tick);
  const lockedChord = respectLocks && activeChord?.locked ? activeChord : undefined;
  const nextLocked = respectLocks
    ? timeline.regions.find(chord => chord.locked && chord.startTick > tick) : undefined;
  return { ...slice, lockedChord, toTick: Math.min(
    slice.toTick, nextKey?.tick ?? Infinity, nextLocked?.startTick ?? Infinity,
    lockedChord ? endOf(lockedChord) : Infinity,
  ) };
}

function planSearch(timeline: Timeline, first: OpenSlice, options: ProgressionSearchOptions) {
  const mode = options.mode ?? "single";
  const length = options.shortLength ?? 3;
  const respectLocks = options.respectLockedChords ?? true;
  let stepTicks = options.stepTicks;
  let bridgeEnd: number | undefined;
  if (mode === "short" && length === "bridge" && !Object.keys(first.notes).length) {
    const next = nextSoundingTick(timeline, first.toTick);
    const step = stepLength(timeline, first.fromTick, stepTicks, options.stepBeats);
    if (next !== undefined && next - first.fromTick <= 4 * step) {
      bridgeEnd = next;
      const gap = next - first.fromTick;
      if (gap > 1 && gap <= step) stepTicks = Math.ceil(gap / 2);
    }
  }
  const requested = mode === "single" ? 1 : length === "bridge" ? 4 : length;
  const slices: OpenSlice[] = [];
  let tick = first.fromTick;
  for (let index = 0; index < requested; index++) {
    const slice = searchSliceAt(timeline, tick, stepLength(timeline, tick, stepTicks, options.stepBeats), respectLocks);
    if (!slice) break;
    slices.push(slice);
    tick = slice.toTick;
    if (tick === bridgeEnd) break;
    if (length === "bridge" && bridgeEnd === undefined && index === 2) break;
  }
  const enough = length === "bridge" && mode === "short"
    ? slices.length >= 2 && (bridgeEnd === undefined || tick === bridgeEnd)
    : slices.length === requested;
  return { slices, enough, mode, bridge: mode === "short" && length === "bridge" };
}

function givenVoiceFor(slice: MelodySlice): HarmonizationGivenVoice | undefined {
  return slice.lockedPitches.soprano ? "soprano" : slice.lockedPitches.bass ? "bass" : undefined;
}

function isTonic(chord: HarmonizationChord) {
  return chord.degree === 1 && chord.family === "tonic" && !chord.applied && !chord.role;
}

function isDominant(chord: HarmonizationChord) {
  return chord.degree === 5 && chord.family === "dominant" && !chord.applied;
}

function connectionScore(
  before: TransitionState, choice: Choice, from: MelodySlice, to: MelodySlice,
  level: HarmonizationRelaxedLevel, style: HarmonizationStyle,
) {
  const left = before.choice.chord;
  const right = choice.chord;
  if (from.key === to.key) {
    if (left.role === "cadential64" && !(left.locked && left.signature === right.signature) &&
      (!isDominant(right) || right.inversion !== 0 ||
        before.choice.voicing.notes[3].midi !== choice.voicing.notes[3].midi)) return -Infinity;
    if (level < 2 && isDominant(left) && left.tones.length === 4 &&
      left.signature !== right.signature && before.choice.voicing.notes.some((note, index) => {
        if (note.tone !== 3) return false;
        const target = choice.voicing.notes[index];
        return !(note.diatonic - target.diatonic === 1 && note.midi - target.midi >= 1 &&
          note.midi - target.midi <= 2) &&
          !(target.tone === 3 && left.rootSignature === right.rootSignature && note.midi === target.midi);
      })) return -Infinity;
  }
  const source = left.role === "cadential64" && before.obligations.heldMetricLevel > from.metricLevel
    ? { ...from, metricLevel: before.obligations.heldMetricLevel as MelodySlice["metricLevel"] } : from;
  const score = scoreTransition(before, choice, source, to, givenVoiceFor(to), level, style);
  if (score === -Infinity) return score;
  if (left.signature === right.signature) return score - (left.tones.length === 4 ? 8 : 3.5);
  if (isDominant(left) && isTonic(right)) return score + (left.tones.length === 4 ? 5 : 2);
  return score;
}

function chordKey(chord: HarmonizationChord) {
  return chord.rootSignature + "|" + serializePitchClass(chord.identity.bass);
}

interface SearchState extends TransitionState {
  parent?: SearchState;
  pathKey: string;
  score: number;
  depth: number;
  slice: MelodySlice;
}

const BEAM_WIDTH = 48;
const VOICINGS_PER_CHORD = 16;

function bestVoicings(voicings: ReturnType<typeof enumerateVoicings>) {
  voicings.sort((a, b) => a.penalty - b.penalty);
  const outerPairs = new Set<number>();
  const kept = voicings.slice(0, VOICINGS_PER_CHORD / 2);
  for (const voicing of kept) outerPairs.add(voicing.notes[0].midi * 128 + voicing.notes[3].midi);
  for (const voicing of voicings.slice(kept.length)) {
    const key = voicing.notes[0].midi * 128 + voicing.notes[3].midi;
    if (outerPairs.has(key)) continue;
    outerPairs.add(key);
    kept.push(voicing);
    if (kept.length >= VOICINGS_PER_CHORD) break;
  }
  return kept;
}

function searchPaths(
  slices: readonly MelodySlice[], left: AnchorState | undefined, right: AnchorState | undefined,
  style: HarmonizationStyle, level: HarmonizationRelaxedLevel,
) {
  const vocabulary = new Map<MelodySlice["key"], HarmonizationChord[]>();
  for (const slice of slices) {
    if (!vocabulary.has(slice.key)) {
      const pitches = slices.filter(item => item.key === slice.key).flatMap(item => Object.values(item.lockedPitches));
      vocabulary.set(slice.key, buildVocabulary(slice.key, style, pitches));
    }
  }
  const voicingCache = new Map<string, ReturnType<typeof enumerateVoicings>>();
  let beam: SearchState[] = [];
  let finals = new Map<string, SearchState[]>();
  for (const [index, slice] of slices.entries()) {
    const last = index === slices.length - 1;
    const next = slices[index + 1] ?? (right?.state ? right.slice : undefined);
    const previous = index ? slices[index - 1] : left?.slice;
    const given = givenVoiceFor(slice) ?? "soprano";
    const choices = slice.lockedChord
      ? [lockedVocabulary(semanticChord(slice.lockedChord, slice.key), slice.key)]
      : vocabulary.get(slice.key)!;
    const paths = new Map<string, SearchState[]>();
    const partialRight = last && right && !right.state
      ? VOICE_ORDER.flatMap((voice, i) => {
        const pitch = right.slice.lockedPitches[voice];
        return pitch ? [{ index: i, midi: toMidi(pitch) }] : [];
      }) : [];
    for (const chord of choices) {
      if (!chord.semantics) continue;
      if (!chord.locked && (chord.role || chord.applied) && next?.key !== slice.key) continue;
      if (!chord.locked && (chord.role === "passing64" || chord.role === "pedal64") &&
        !(index || left?.state)) continue;
      if (!chord.locked && chord.role === "cadential64" &&
        !(next && slice.metricLevel >= 2 && slice.metricLevel > next.metricLevel)) continue;
      const allowOmittedTonicFifth = isTonic(chord) && chord.inversion === 0 && Boolean(index || left?.state);
      const cacheKey = JSON.stringify([slice.key.tick, chord.signature, slice.lockedChord?.id, allowOmittedTonicFifth,
        ...VOICE_ORDER.map(voice => slice.lockedPitches[voice] && serializeSpelledPitch(slice.lockedPitches[voice]))]);
      let voicings = voicingCache.get(cacheKey);
      if (!voicings) {
        voicings = enumerateVoicings(chord, given, slice.lockedPitches[given], slice.lockedPitches, level,
          { allowOmittedTonicFifth });
        if (slices.length > 1) voicings = bestVoicings(voicings);
        voicingCache.set(cacheKey, voicings);
      }
      const key = chordKey(chord);
      for (const voicing of voicings) {
        const choice = { chord, voicing, score: 0 };
        choice.score = scoreChoice(choice, slice, style);
        if (!index && !left?.state && !slice.phraseStart && isTonic(chord) && chord.inversion === 0) choice.score += 4;
        if (!index && !left?.state && isTonic(chord) && chord.inversion === 1) choice.score += 2;
        if (chord.role === "cadential64" && index === slices.length - 3) choice.score += 9;
        if (partialRight.length) {
          for (const note of partialRight) {
            const distance = Math.abs(voicing.notes[note.index].midi - note.midi);
            choice.score += distance === 0 ? 0.8 : distance <= 2 ? 0.4 : -distance * 0.25;
          }
        }
        if (last && slices.length > 1 && !right?.state && isTonic(chord)) choice.score += 3;
        const extend = (prior?: TransitionState, path?: SearchState) => {
          const cost = prior && previous ? connectionScore(prior, choice, previous, slice, level, style) : 0;
          if (cost === -Infinity) return;
          const score = (path?.score ?? 0) + cost + choice.score;
          const pathKey = path ? path.pathKey + "\n" + key : key;
          const retained = paths.get(pathKey);
          if (!last && retained && retained.length >= 5 && retained[4].score >= score) return;
          const state: SearchState = {
            choice, slice, previous: prior, parent: path, pathKey, depth: index + 1, score,
            obligations: obligationsAfter(choice, slice, prior),
          };
          if (last && right?.state) {
            const exit = connectionScore(state, right.state.choice, slice, right.slice, level === 2 ? 1 : level, style);
            if (exit === -Infinity) return;
            state.score += exit;
          }
          if (!retained) {
            paths.set(pathKey, [state]);
            return;
          }
          const position = retained.findIndex(other => state.score > other.score);
          const cap = last ? (slices.length === 1 ? 18 : 6) : 5;
          if (position < 0) {
            if (retained.length < cap) retained.push(state);
          } else {
            retained.splice(position, 0, state);
            if (retained.length > cap) retained.pop();
          }
        };
        if (index) {
          for (const prior of beam) extend(prior, prior);
        } else {
          extend(left?.state);
        }
      }
    }
    if (!paths.size) return [];
    if (last) finals = paths;
    else beam = [...paths.values()].flat().sort((a, b) => b.score - a.score).slice(0, BEAM_WIDTH);
  }
  return [...finals.values()].sort((a, b) => b[0].score - a[0].score);
}

function canGenerateInRange(project: ProjectDocument, track: ProjectDocument["satbTracks"][number], range: HarmonizationRange) {
  return !track.locked && !project.exercise.editableRanges.some(item =>
    !item.editable && item.voiceIds.includes(track.id) && item.fromTick < range.toTick && range.fromTick < item.toTick,
  );
}

function writeSteps(project: ProjectDocument, steps: readonly ProgressionStep[], prefix: string, writeChords: boolean) {
  let addedNoteCount = 0;
  let addedChordCount = 0;
  for (const track of project.satbTracks) {
    const added = steps.filter(step => step.generatedVoices.includes(track.id)).map(step => ({
      id: `${prefix}-${track.id}-${step.fromTick}`, startTick: step.fromTick, durationTicks: step.toTick - step.fromTick,
      pitch: step.notes[track.id], locked: false, velocity: 78, spellingSource: "manual" as const,
    }));
    addedNoteCount += added.length;
    if (added.length) track.notes = [...track.notes, ...added].sort((a, b) => a.startTick - b.startTick);
  }
  if (writeChords) {
    const range = { fromTick: steps[0].fromTick, toTick: steps.at(-1)!.toTick };
    const additions = steps.map(step => ({
      id: `${prefix}-chord-${step.fromTick}`, startTick: step.fromTick, durationTicks: step.toTick - step.fromTick,
      identity: step.chord.identity, semantics: step.chord.semantics, locked: false,
    }));
    const keys = orderedEvents(project.keyEvents);
    const original = project.chordTrack.regions;
    const oldEnd = original.find(chord => chord.startTick < range.toTick && endOf(chord) > range.toTick);
    project.chordTrack.regions = replaceRange(original, additions, range, true).map(chord =>
      oldEnd && !oldEnd.locked && chord.startTick === range.toTick
        ? chordWithOriginalKey(chord, eventAtTick(keys, oldEnd.startTick), eventAtTick(keys, chord.startTick)) : chord);
    addedChordCount = project.chordTrack.regions.filter(chord => chord.id.startsWith(prefix + "-chord-")).length;
    project.chordTrack.cadenceAnnotations = reconcileCadences(project, project.chordTrack.cadenceAnnotations);
  }
  return { addedNoteCount, addedChordCount };
}

function toSteps(state: SearchState) {
  const steps: ProgressionStep[] = [];
  for (let entry: SearchState | undefined = state; entry; entry = entry.parent) {
    const { slice, choice: { chord, voicing } } = entry;
    const notes = Object.fromEntries(
      VOICE_ORDER.map((voice, index) => [voice, voicing.notes[index].pitch]),
    ) as Record<VoiceId, SpelledPitch>;
    steps.push({
      fromTick: slice.tick, toTick: slice.endTick,
      chord: { label: labelFor(chord, slice.key), identity: chord.identity, semantics: chord.semantics! },
      notes, generatedVoices: VOICE_ORDER.filter(voice => !slice.lockedPitches[voice]),
    });
  }
  return steps.reverse();
}

function pathTag(state: SearchState, left: AnchorState | undefined, right: AnchorState | undefined, bridge: boolean) {
  if (bridge && left && right) return "双向桥接";
  const path: HarmonizationChord[] = [];
  for (let entry: SearchState | undefined = state; entry; entry = entry.parent) path.unshift(entry.choice.chord);
  if (left?.state) path.unshift(left.state.choice.chord);
  if (right?.state) path.push(right.state.choice.chord);
  if (path.some(chord => chord.role === "passing64")) return "经过四六";
  if (path.some(chord => chord.role === "pedal64")) return "辅助延长";
  if (path.some(chord => chord.applied)) return "副属推进";
  const last = path.at(-1)!;
  const before = path.at(-2);
  if (before && isDominant(before) && isTonic(last)) return "正格收束";
  if (before && isDeceptive(before, last)) return "阻碍进行";
  if (state.depth > 1 && isDominant(last)) return "半终止";
  return "平稳连接";
}

function previewFor(
  template: ReturnType<typeof cropProject>, steps: readonly ProgressionStep[], fromTick: number,
  toTick: number, right: AnchorState | undefined,
) {
  const { origin, project } = template;
  const preview = {
    ...project,
    satbTracks: project.satbTracks.map(track => ({ ...track })),
    chordTrack: { ...project.chordTrack },
  };
  const local = steps.map(step => ({ ...step, fromTick: step.fromTick - origin, toTick: step.toTick - origin }));
  writeSteps(preview, local, "progression-preview", true);
  if (!validateProject(preview)) return undefined;
  const previewRange = { fromTick: fromTick - origin, toTick: toTick - origin };
  const diagnosticSummary: DiagnosticSummary = { errorCount: 0, warningCount: 0, suggestionCount: 0 };
  for (const item of checkHarmony(preview).diagnostics) {
    const start = local[0].fromTick;
    const seam = local.at(-1)!.toTick;
    if ((item.tick < start && item.endTick <= start) || (right ? item.tick > seam : item.tick >= seam)) continue;
    if (item.severity === "error") diagnosticSummary.errorCount++;
    else if (item.severity === "warning") diagnosticSummary.warningCount++;
    else if (item.severity === "suggestion") diagnosticSummary.suggestionCount++;
  }
  return { preview, previewRange, diagnosticSummary };
}

function addAnchorChord(template: ReturnType<typeof cropProject>, anchor?: AnchorState) {
  const chord = anchor?.state?.choice.chord;
  if (!anchor || !chord?.semantics) return;
  const { project, origin } = template;
  const range = { fromTick: anchor.range.fromTick - origin, toTick: Math.min(project.lengthTicks, anchor.range.toTick - origin) };
  if (range.toTick <= range.fromTick || project.chordTrack.regions.some(region => overlaps(region, range))) return;
  project.chordTrack.regions.push({
    id: `progression-anchor-${range.fromTick}`, startTick: range.fromTick, durationTicks: range.toTick - range.fromTick,
    identity: chord.identity, semantics: chord.semantics, locked: false,
  });
  project.chordTrack.regions.sort((a, b) => a.startTick - b.startTick);
}

function arrangementLabel(step: ProgressionStep) {
  const tight = step.notes.soprano.octave * 7 + stepIndex(step.notes.soprano.step) -
    (step.notes.tenor.octave * 7 + stepIndex(step.notes.tenor.step)) < 7;
  return tight ? "密集排列" : "开放排列";
}

export function searchProgressionCandidates(project: ProjectDocument, options: ProgressionSearchOptions): ProgressionSearchResult {
  const started = performance.now();
  const warnings: string[] = [];
  const finish = (candidates: ProgressionCandidate[], slot?: OpenSlotContext): ProgressionSearchResult => ({
    slot, candidates, warnings, elapsedMs: performance.now() - started,
  });
  const timeline = timelineFor(project);
  const first = firstOpenSlice(timeline, options.fromTick, options.stepTicks, options.stepBeats);
  if (!first) return finish([]);
  const plan = planSearch(timeline, first, options);
  const end = plan.slices.at(-1)!.toTick;
  const left = leftAnchorFor(timeline, first.fromTick);
  const nearestRight = rightAnchorFor(timeline, end);
  const right = nearestRight?.range.fromTick === end ? nearestRight : undefined;
  const step = stepLength(timeline, first.fromTick, options.stepTicks, options.stepBeats);
  const slot = structuredClone(contextFor(plan.slices[0], left, nearestRight, step));
  if (plan.mode === "short") slot.spanEndTick = end;
  if (!plan.enough) {
    warnings.push("当前空位不足以容纳所选步数。");
    return finish([], slot);
  }

  if (plan.slices.some(slice => project.satbTracks.some(track => !slice.notes[track.id] && !canGenerateInRange(project, track, slice)))) {
    warnings.push("目标空位有待填声部或时段已锁定。");
    return finish([], slot);
  }
  const slices = plan.slices.map(item => asMelodySlice(timeline, item));
  const style = options.style ?? "textbook-standard";
  const maximum = Number.isFinite(options.maxCandidates)
    ? Math.max(0, Math.trunc(options.maxCandidates!)) : plan.mode === "single" ? 8 : 6;
  if (!maximum) return finish([], slot);
  const anchorStart = left?.range.fromTick ?? first.fromTick;
  const previewStart = Math.max(anchorStart, first.fromTick - timeline.beatAt(Math.max(0, first.fromTick - 1)));
  const contextStart = Math.max(0, anchorStart - (left ? timeline.beatAt(Math.max(0, anchorStart - 1)) : 0));
  const previewEnd = right ? Math.min(right.range.toTick, end + timeline.beatAt(end)) : end;
  const template = cropProject(timeline, contextStart, previewEnd);
  addAnchorChord(template, left);
  addAnchorChord(template, right);
  if (options.respectLockedChords === false) {
    const range = { fromTick: first.fromTick - template.origin, toTick: end - template.origin };
    template.project.chordTrack.regions = template.project.chordTrack.regions.map(chord =>
      chord.locked && overlaps(chord, range) ? { ...chord, locked: false } : chord);
  }
  const fallback: ProgressionCandidate[] = [];
  for (const level of [0, 1, 2] as const) {
    const groups = searchPaths(slices, left, right, style, level);
    const candidates: ProgressionCandidate[] = [];
    const filledTags = new Set<string>();
    // At most two passes through the groups. Short paths with a different musical role get a seat first.
    const tagFor = (state: SearchState) => pathTag(state, left, right, plan.bridge);
    const diverse = plan.mode === "short" ? groups.filter(group => {
      const tag = tagFor(group[0]);
      if (filledTags.has(tag)) return false;
      filledTags.add(tag);
      return true;
    }) : [];
    const orderedGroups = [...new Set([...diverse, ...groups])];
    // Each alternate needs its own rule pass. Prioritize verifying a best voicing for every card.
    let alternateChecks = 3;
    for (const [index, paths] of orderedGroups.entries()) {
      const variants: ProgressionVoicingVariant[] = [];
      const labels = new Set<string>();
      const arrangements = new Set<string>();
      let candidate: ProgressionCandidate | undefined;
      let rejected: ProgressionCandidate | undefined;
      const id = `progression-${first.fromTick}-${level}-${index}`;
      for (const state of paths.slice(0, 8)) {
        if (candidate && (plan.mode === "short" || !alternateChecks || variants.length >= 3)) break;
        const steps = toSteps(state);
        const spacing = plan.mode === "single" ? arrangementLabel(steps[0]) : "推荐排列";
        const soprano = steps[0].notes.soprano;
        const arrangement = spacing + serializeSpelledPitch(soprano);
        const label = labels.has(spacing) ? `高音 ${formatSpelledPitch(soprano)}` : spacing;
        if (labels.has(label) || arrangements.has(arrangement)) continue;
        if (candidate) alternateChecks--;
        const checked = previewFor(template, steps, previewStart, previewEnd, right);
        if (!checked) continue;
        const { diagnosticSummary } = checked;
        const variant = {
          id: `${id}-${variants.length}`, label, steps, score: state.score, diagnosticSummary,
          previewProject: checked.preview,
        };
        if (diagnosticSummary.errorCount) {
          if (level !== 2 || candidate ||
            (rejected && rejected.diagnosticSummary.errorCount <= diagnosticSummary.errorCount)) continue;
        } else {
          variants.push(variant);
          labels.add(label);
          arrangements.add(arrangement);
          if (candidate) continue;
        }
        const card = {
          id, fromTick: first.fromTick, toTick: end, mode: plan.mode,
          headline: steps.map(step => step.chord.label).join(" → "), tag: tagFor(state),
          steps, score: state.score, diagnosticSummary, relaxedLevel: level,
          variants: diagnosticSummary.errorCount ? [variant] : variants,
          previewProject: checked.preview, previewRange: checked.previewRange,
        };
        if (diagnosticSummary.errorCount) rejected = card;
        else candidate = card;
      }
      if (candidate) candidates.push(candidate);
      else if (rejected) fallback.push(rejected);
      if (candidates.length >= maximum) break;
    }
    if (candidates.length) {
      if (level > 0) warnings.push("已放宽部分配声限制。");
      return finish(structuredClone(candidates), slot);
    }
  }
  fallback.sort((a, b) => a.diagnosticSummary.errorCount - b.diagnosticSummary.errorCount || b.score - a.score);
  warnings.push(fallback.length ? "候选含和声检查错误，采纳前请复核。" : "当前空位未找到可用的和声连接。");
  return finish(structuredClone(fallback.slice(0, maximum)), slot);
}

export function applyProgressionCandidate(
  project: ProjectDocument, candidate: ProgressionCandidate, options: { variantIndex?: number; writeChords?: boolean } = {},
): { project: ProjectDocument; nextCursorTick: number; addedNoteCount: number; addedChordCount: number } {
  const steps = options.variantIndex === undefined ? candidate.steps : candidate.variants[options.variantIndex]?.steps;
  let tick = candidate.fromTick;
  if (!steps?.length || !Number.isSafeInteger(tick) || tick < 0 || candidate.toTick > project.lengthTicks) {
    throw new Error("候选区间或排列无效。");
  }
  for (const step of steps) {
    if (step.fromTick !== tick || !Number.isSafeInteger(step.toTick) || step.toTick <= tick) {
      throw new Error("候选区间或排列无效。");
    }
    tick = step.toTick;
    for (const track of project.satbTracks) {
      const notes = track.notes.filter(note => overlaps(note, step));
      if (step.generatedVoices.includes(track.id)) {
        if (!canGenerateInRange(project, track, step)) throw new Error("待填声部或时段已锁定。");
        if (notes.length) throw new Error("槽位已有新音符，请重新搜索和声连接。");
      } else {
        let covered = step.fromTick;
        for (const note of notes.sort((a, b) => a.startTick - b.startTick)) {
          if (note.startTick > covered || !spelledPitchEquals(note.pitch, step.notes[track.id])) break;
          covered = Math.max(covered, endOf(note));
        }
        if (covered < step.toTick) throw new Error("固定声部已变更，请重新搜索和声连接。");
      }
    }
  }
  if (tick !== candidate.toTick) throw new Error("候选区间或排列无效。");

  const output = structuredClone(project);
  const counts = writeSteps(output, structuredClone(steps), createId("progression"),
    options.writeChords !== false && !project.chordTrack.locked);
  output.updatedAt = new Date().toISOString();
  if (!validateProject(output)) throw new Error("候选无法写入当前工程。");
  return { project: output, nextCursorTick: candidate.toTick, ...counts };
}
