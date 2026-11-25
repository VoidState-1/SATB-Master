import { identityContainsWrittenPitchClass } from "../../../chordModel";
import { spelledPitchEquals, toMidi } from "../../../pitch";
import type { VoiceId } from "../../../project/types";
import { VOICE_ORDER } from "../../../project/voice";
import { sameChordIdentityWithoutBass, type AnalysisChord, type AnalysisNote, type AnalysisSlice } from "../../analysis";
import { createWrittenOrnamentReader, endOfWrittenNote } from "../../facts/ornamentalMotion";
import { soundsDeclaredChord } from "../../facts/writtenVoicing";
import type { HarmonyRuleContext } from "../context/createRuleContext";
import { voicePairTransitionFacts, type StructuralVoicePairComparison } from "../sharedFacts";
import { isVerifiedChordOrnament } from "./ornaments";

const cache = new WeakMap<HarmonyRuleContext, readonly StructuralVoicePairComparison[]>();

function member(chord: AnalysisChord, note: AnalysisNote) {
  return identityContainsWrittenPitchClass(chord.identity, note.pitch);
}

function collect(context: HarmonyRuleContext): StructuralVoicePairComparison[] {
  const { analysis } = context;
  const cuts = [...analysis.phraseBoundaries.map(mark => mark.tick),
    ...analysis.project.keyEvents.map(event => event.tick),
    ...analysis.project.meterEvents.map(event => event.tick)];
  let readOrnament: ReturnType<typeof createWrittenOrnamentReader> | undefined;
  function shortOrnament(slice: AnalysisSlice, voice: VoiceId, chord: AnalysisChord,
    destination: AnalysisNote, limit: number) {
    const note = slice.notes[voice];
    if (!note || destination.startTick !== endOfWrittenNote(note) ||
        note.durationTicks > limit || member(chord, note)) return;
    if (note.nonChordToneRole === "appoggiatura" || note.nonChordToneRole === "escape") {
      const view = context.notes({ voiceId: voice, startingAt: note.startTick }).first();
      const previous = view && context.noteNeighborhood(view)?.previous?.note;
      if (view && previous && endOfWrittenNote(previous) === note.startTick &&
          isVerifiedChordOrnament(context, chord, view))
        return { entryTick: note.startTick, departureId: previous.id };
      return;
    }
    readOrnament ??= createWrittenOrnamentReader(context.slices().select(frame => ({
      ...frame, identities: frame.chord ? [frame.chord.identity] : [],
      harmonyRegionId: frame.chord?.id,
      metric: context.metric.positionAt(frame.tick),
    })).toArray(), cuts, analysis.project.ppq);
    const proof = readOrnament(slice.index, voice, chord.identity);
    if (proof?.role === "passing" && proof.ornaments.length === 1 &&
        proof.arrival.note.id === destination.id && destination.startTick - proof.entryTick <= limit)
      return { entryTick: proof.entryTick, departureId: proof.departure.note.id };
  }

  const result: StructuralVoicePairComparison[] = [];
  for (const anchor of context.sliceTransitions()) {
    const { previous, current: entry } = anchor;
    const source = previous.chord, target = entry.chord;
    if (!anchor.contiguous || !anchor.sameKey || !source || !target ||
        !previous.completeSatb || !entry.completeSatb ||
        sameChordIdentityWithoutBass(source.identity, target.identity)) continue;
    const metric = context.metric.positionAt(entry.tick);
    if (!metric || metric.role === "subdivision") continue;
    const beat = analysis.metricTimeline.measures[metric.measureNumber - 1]?.beatLength;
    if (!beat) continue;
    const limit = Math.min(beat, analysis.project.ppq) / 2;
    const weak = (tick: number) => context.metric.positionAt(tick)?.role === "subdivision";
    const landings = context.slices({ overlapping: { fromTick: entry.tick, toTick: entry.tick + limit + 1 } });
    for (const landing of landings) {
      if (!landing.completeSatb || landing.chord?.id !== target.id ||
          (landing.tick !== entry.tick && !weak(landing.tick))) continue;
      for (const [i, left] of VOICE_ORDER.entries()) {
        for (const right of VOICE_ORDER.slice(i + 1)) {
          const voices = [left, right] as const;
          const arrival = [landing.notes[left]!, landing.notes[right]!] as const;
          if (!arrival.some(note => note.startTick === entry.tick) ||
              Math.max(...arrival.map(note => note.startTick)) !== landing.tick ||
              arrival.some(note => endOfWrittenNote(note) - landing.tick < limit) ||
              target.startTick + target.durationTicks - landing.tick < limit) continue;
          const early = arrival.findIndex(note => note.startTick < entry.tick);
          if (early !== -1 && (entry.tick - arrival[early].startTick > limit ||
              !weak(arrival[early].startTick) || member(source, arrival[early]) ||
              (arrival[early].nonChordToneRole && arrival[early].nonChordToneRole !== "anticipation"))) continue;
          // Only a sounding early arrival confirmed by the full landing can
          // be promoted from an anticipation to a target chord member.
          const landingFrame = early !== -1 && arrival[early].nonChordToneRole === "anticipation"
            ? { ...landing, notes: { ...landing.notes, [voices[early]]: { ...arrival[early], nonChordToneRole: undefined } } }
            : landing;
          if (!soundsDeclaredChord(landingFrame)) continue;

          let departure: AnalysisSlice | undefined = early === -1 ? previous : context.sliceAt(arrival[early].startTick - 1);
          if (!departure?.completeSatb || departure.chord?.id !== source.id) continue;
          const masks = new Map<VoiceId, string>();
          for (const [j, voice] of voices.entries()) {
            const surface = departure.notes[voice]!;
            if (member(source, surface)) continue;
            const proof = shortOrnament(departure, voice, source, arrival[j], limit);
            if (!proof || entry.tick - proof.entryTick > limit || !weak(proof.entryTick)) continue;
            masks.set(voice, surface.id);
            departure = context.sliceAt(proof.entryTick - 1) ?? departure;
          }
          if (departure.chord?.id !== source.id || !soundsDeclaredChord(departure)) continue;
          if (early === -1 && landing.tick === entry.tick && masks.size === 0) continue;
          const from = departure;
          const late = arrival.findIndex(note => note.startTick > entry.tick);
          if (late !== -1) {
            const voice = voices[late];
            const surface = entry.notes[voice]!;
            if (member(target, surface)) continue; // consonant independent motion is not a delay
            if (surface.id !== from.notes[voice]!.id && surface.id !== masks.get(voice)) {
              const proof = shortOrnament(entry, voice, target, arrival[late], limit);
              if (!proof || proof.departureId !== from.notes[voice]!.id || masks.size > 0) continue;
              masks.set(voice, surface.id);
            }
          }
          if (masks.size > 1 ||
              voices.some((voice, j) => toMidi(from.notes[voice]!.pitch) === toMidi(arrival[j].pitch)) ||
              cuts.some(tick => Math.max(from.notes[left]!.startTick, from.notes[right]!.startTick) < tick &&
                tick <= landing.tick)) continue;

          // An independent part must confirm the anchor. A new event in
          // another attack group, a rest, or an unproved surface note breaks it.
          const accompaniment = VOICE_ORDER.filter(voice => voice !== left && voice !== right);
          if (!accompaniment.some(voice => entry.notes[voice]!.startTick === entry.tick &&
              !spelledPitchEquals(from.notes[voice]!.pitch, entry.notes[voice]!.pitch))) continue;
          const path = context.slices({ overlapping: { fromTick: from.tick, toTick: landing.tick + 1 } });
          const continuous = path.all(frame => frame.completeSatb &&
            frame.chord?.id === (frame.tick < entry.tick ? source.id : target.id) &&
            VOICE_ORDER.every(voice => {
              const note = frame.notes[voice]!;
              const old = from.notes[voice]!;
              if (voice === left || voice === right)
                return note.id === old.id || note.id === landing.notes[voice]!.id || note.id === masks.get(voice);
              const structural = frame.tick < entry.tick ? old : landing.notes[voice]!;
              return !note.nonChordToneRole && spelledPitchEquals(structural.pitch, note.pitch);
            }));
          if (!continuous) continue;
          const transition = {
            ...anchor, previous: from, previousIndex: from.index, current: landingFrame, currentIndex: landing.index,
            changedVoiceIds: VOICE_ORDER.filter(voice => from.notes[voice]?.id !== landing.notes[voice]?.id),
          };
          const fact = voicePairTransitionFacts(transition).find(item => item.voiceIds[0] === left && item.voiceIds[1] === right);
          if (fact) result.push({ transition, fact, boundaryTick: entry.tick });
        }
      }
    }
  }
  return result;
}

export function structuralVoicePairComparisons(context: HarmonyRuleContext) {
  let comparisons = cache.get(context);
  if (!comparisons) {
    comparisons = collect(context);
    cache.set(context, comparisons);
  }
  return comparisons;
}
