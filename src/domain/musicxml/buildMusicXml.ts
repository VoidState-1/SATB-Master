import { buildScorePreviewModel } from "../notation/buildScorePreviewModel";
import type {
  NotationDuration,
  ScoreAuxiliaryPitchEntry,
  ScoreAuxiliaryStaff,
  ScoreEvent,
  ScoreMeasure,
  ScoreRestEvent,
  ScoreStaff,
} from "../notation/types";
import { getExportAuxiliaryTracks, melodicMidiChannel } from "../exportTracks";
import { formatChordRegion } from "../chords";
import { keySignatureFifths } from "../pitch";
import type { ProjectDocument, TempoEvent, VoiceId } from "../project";
import {
  DEFAULT_MUSICXML_EXPORT_OPTIONS,
  type MusicXmlExportOptions,
} from "./types";

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function durationTypeToMusicXml(value: string): string {
  switch (value) {
    case "w":
      return "whole";
    case "h":
      return "half";
    case "q":
      return "quarter";
    case "8":
      return "eighth";
    case "16":
      return "16th";
    case "32":
      return "32nd";
    case "64":
      return "64th";
    default:
      return "quarter";
  }
}

function formatNoteEventXml(
  event: ScoreAuxiliaryPitchEntry,
  duration: NotationDuration,
  voiceNumber: number,
  { staffNumber, stemDirection, chord }: {
    staffNumber?: number;
    stemDirection?: "up" | "down";
    chord?: boolean;
  },
): string {
  const lines: string[] = [];
  lines.push("      <note>");
  if (chord) lines.push("        <chord/>");
  lines.push("        <pitch>");
  lines.push(`          <step>${event.pitch.step}</step>`);
  if (event.pitch.alter !== 0) {
    lines.push(`          <alter>${event.pitch.alter}</alter>`);
  }
  lines.push(`          <octave>${event.pitch.octave}</octave>`);
  lines.push("        </pitch>");
  lines.push(`        <duration>${duration.ticks}</duration>`);

  if (event.tieFromPrevious) {
    lines.push('        <tie type="stop"/>');
  }
  if (event.tieToNext) {
    lines.push('        <tie type="start"/>');
  }

  lines.push(`        <voice>${voiceNumber}</voice>`);
  lines.push(`        <type>${durationTypeToMusicXml(duration.value)}</type>`);

  for (let i = 0; i < duration.dots; i++) {
    lines.push("        <dot/>");
  }

  if (stemDirection) lines.push(`        <stem>${stemDirection}</stem>`);
  if (staffNumber !== undefined) lines.push(`        <staff>${staffNumber}</staff>`);

  if (event.tieFromPrevious || event.tieToNext) {
    lines.push("        <notations>");
    if (event.tieFromPrevious) {
      lines.push('          <tied type="stop"/>');
    }
    if (event.tieToNext) {
      lines.push('          <tied type="start"/>');
    }
    lines.push("        </notations>");
  }

  lines.push("      </note>");
  return lines.join("\n");
}

function formatRestEventXml(
  event: ScoreRestEvent,
  voiceNumber: number,
  staffNumber?: number,
): string {
  const lines: string[] = [];
  lines.push("      <note>");
  lines.push("        <rest/>");
  lines.push(`        <duration>${event.duration.ticks}</duration>`);
  lines.push(`        <voice>${voiceNumber}</voice>`);
  lines.push(`        <type>${durationTypeToMusicXml(event.duration.value)}</type>`);
  for (let i = 0; i < event.duration.dots; i++) {
    lines.push("        <dot/>");
  }
  if (staffNumber !== undefined) lines.push(`        <staff>${staffNumber}</staff>`);
  lines.push("      </note>");
  return lines.join("\n");
}

function formatEventXml(
  event: ScoreEvent,
  voiceNumber: number,
  staffNumber: number,
  stemDirection: "up" | "down",
): string {
  if (event.kind === "note") {
    return formatNoteEventXml(event, event.duration, voiceNumber, { staffNumber, stemDirection });
  }
  if (event.kind === "rest") {
    return formatRestEventXml(event, voiceNumber, staffNumber);
  }
  throw new Error("检测到未识别的乐谱事件类型，无法导出。");
}

function appendMeasureAttributes(
  lines: string[],
  measure: ScoreMeasure,
  previous: ScoreMeasure | undefined,
  ppq: number,
  clefs: readonly ScoreStaff[],
) {
  const keyChanged =
    !previous ||
    measure.key.tonic.step !== previous.key.tonic.step ||
    measure.key.tonic.alter !== previous.key.tonic.alter ||
    measure.key.mode !== previous.key.mode;
  const timeChanged =
    !previous ||
    measure.numerator !== previous.numerator ||
    measure.denominator !== previous.denominator;
  if (!keyChanged && !timeChanged) return;

  lines.push("      <attributes>");
  if (!previous) lines.push(`        <divisions>${ppq}</divisions>`);
  if (keyChanged) {
    lines.push("        <key>");
    lines.push(`          <fifths>${keySignatureFifths(measure.key)}</fifths>`);
    lines.push(`          <mode>${measure.key.mode}</mode>`);
    lines.push("        </key>");
  }
  if (timeChanged) {
    lines.push("        <time>");
    lines.push(`          <beats>${measure.numerator}</beats>`);
    lines.push(`          <beat-type>${measure.denominator}</beat-type>`);
    lines.push("        </time>");
  }
  if (!previous) {
    const multiStaff = clefs.length > 1;
    if (multiStaff) lines.push(`        <staves>${clefs.length}</staves>`);
    clefs.forEach((clef, index) => {
      lines.push(multiStaff ? `        <clef number="${index + 1}">` : "        <clef>");
      lines.push(`          <sign>${clef === "bass" ? "F" : "G"}</sign>`);
      lines.push(`          <line>${clef === "bass" ? 4 : 2}</line>`);
      lines.push("        </clef>");
    });
  }
  lines.push("      </attributes>");
}

function appendTempoDirections(
  lines: string[],
  measure: ScoreMeasure,
  isFirst: boolean,
  tempos: readonly TempoEvent[],
) {
  const inMeasure = tempos.filter(
    ({ tick }) => tick >= measure.fromTick && tick < measure.toTick,
  );
  const directions = isFirst && inMeasure.length === 0
    ? [{ tick: measure.fromTick, bpm: tempos[0]?.bpm ?? 120 }]
    : inMeasure;
  directions.forEach(({ tick, bpm }) => {
    lines.push('      <direction placement="above">');
    lines.push("        <direction-type>");
    lines.push('          <metronome parentheses="no">');
    lines.push("            <beat-unit>quarter</beat-unit>");
    lines.push(`            <per-minute>${bpm}</per-minute>`);
    lines.push("          </metronome>");
    lines.push("        </direction-type>");
    if (tick > measure.fromTick) {
      lines.push(`        <offset sound="yes">${tick - measure.fromTick}</offset>`);
    }
    lines.push(`        <sound tempo="${bpm}"/>`);
    lines.push("      </direction>");
  });
}

function appendAuxiliaryStaff(
  lines: string[],
  staff: ScoreAuxiliaryStaff,
  measureDuration: number,
) {
  staff.lanes.forEach((lane, index) => {
    if (index > 0) {
      lines.push("      <backup>");
      lines.push(`        <duration>${measureDuration}</duration>`);
      lines.push("      </backup>");
    }
    const voiceNumber = lane.laneIndex + 1;
    for (const event of lane.events) {
      if (event.kind === "rest") {
        lines.push(formatRestEventXml(event, voiceNumber));
      } else if (event.kind === "chord") {
        event.notes.forEach((note, noteIndex) => {
          lines.push(formatNoteEventXml(note, event.duration, voiceNumber, {
            chord: noteIndex > 0,
            stemDirection: lane.stemDirection,
          }));
        });
      } else {
        throw new Error("检测到未识别的乐谱事件类型，无法导出。");
      }
    }
  });
}

function getAnalysisLabel(
  project: ProjectDocument,
  formatted: ReturnType<typeof formatChordRegion>,
): string | undefined {
  if (project.chordTrack.displayMode === "functional") {
    if (formatted.functional && formatted.functional !== "?") {
      return formatted.functional;
    }
    if (formatted.roman && formatted.roman !== "?") {
      return formatted.roman;
    }
  } else {
    if (formatted.roman && formatted.roman !== "?") {
      return formatted.roman;
    }
    if (formatted.functional && formatted.functional !== "?") {
      return formatted.functional;
    }
  }
  return undefined;
}

export function buildMusicXml(
  project: ProjectDocument,
  userOptions?: MusicXmlExportOptions,
): string {
  const options = {
    ...DEFAULT_MUSICXML_EXPORT_OPTIONS,
    ...userOptions,
  };

  const auxiliaryTracks = getExportAuxiliaryTracks(project, options);
  const includedAuxiliaryTrackIds = auxiliaryTracks.map((track) => track.id);
  const scoreModel = buildScorePreviewModel(project, { includedAuxiliaryTrackIds });

  // 避免导出时静默丢弃无法记谱的片段。
  const unsupportedRhythm = scoreModel.warnings.find(
    (warning) => warning.code === "unsupported-rhythm",
  );
  if (unsupportedRhythm) {
    const track = auxiliaryTracks.find(({ id }) => id === unsupportedRhythm.trackId);
    const location = track ? `额外声部「${track.name}」在` : "在";
    const remedy = track ? "请在导出选项中取消勾选该声部，或将音符对齐到网格时值。" : "请先将音符对齐到网格时值。";
    throw new Error(
      `无法导出 MusicXML：${location} Tick ${unsupportedRhythm.fromTick} 处检测到非标准节奏音符。${remedy}`,
    );
  }
  const omittedOverlap = scoreModel.warnings.find(
    (warning) => warning.code === "invalid-overlap" && warning.trackId !== undefined,
  );
  if (omittedOverlap) {
    const track = auxiliaryTracks.find(({ id }) => id === omittedOverlap.trackId);
    throw new Error(
      `无法导出 MusicXML：额外声部「${track?.name ?? omittedOverlap.trackId}」在 Tick ${omittedOverlap.fromTick} 处超出记谱声部上限。请在导出选项中取消勾选该声部，或将重叠音符拆到多条额外声部。`,
    );
  }

  const satbPartCount = options.layout === "grand-staff" || options.layout === "single-staff" ? 1 : 4;
  const auxiliaryParts = auxiliaryTracks.map((track, index) => ({
    track,
    id: `P${satbPartCount + index + 1}`,
    channel: melodicMidiChannel(satbPartCount + index) + 1,
  }));

  const title = project.title?.trim() || "SATB Score";
  const composer = project.author?.trim() || "SATB Master";

  const xmlLines: string[] = [];
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlLines.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  xmlLines.push('<score-partwise version="4.0">');

  // Work & Identification
  xmlLines.push("  <work>");
  xmlLines.push(`    <work-title>${xmlEscape(title)}</work-title>`);
  xmlLines.push("  </work>");
  xmlLines.push("  <identification>");
  xmlLines.push(`    <creator type="composer">${xmlEscape(composer)}</creator>`);
  xmlLines.push("    <encoding>");
  xmlLines.push("      <software>SATB Master</software>");
  xmlLines.push("      <encoding-date>2026-08-28</encoding-date>");
  xmlLines.push('      <supports element="accidental" type="yes"/>');
  xmlLines.push('      <supports element="beam" type="yes"/>');
  xmlLines.push('      <supports element="stem" type="yes"/>');
  xmlLines.push("    </encoding>");
  xmlLines.push("  </identification>");

  // Part List
  xmlLines.push("  <part-list>");
  if (satbPartCount === 1) {
    xmlLines.push('    <score-part id="P1">');
    xmlLines.push(
      options.layout === "single-staff"
        ? "      <part-name>SATB Score</part-name>"
        : "      <part-name>Piano / Choir</part-name>",
    );
    xmlLines.push("      <part-abbreviation>SATB</part-abbreviation>");
    xmlLines.push('      <score-instrument id="P1-I1">');
    xmlLines.push("        <instrument-name>Acoustic Grand Piano</instrument-name>");
    xmlLines.push("      </score-instrument>");
    xmlLines.push('      <midi-instrument id="P1-I1">');
    xmlLines.push("        <midi-channel>1</midi-channel>");
    xmlLines.push("        <midi-program>1</midi-program>");
    xmlLines.push("      </midi-instrument>");
    xmlLines.push("    </score-part>");
  } else {
    // SATB Separate: 按照 MusicXML 4.0 DTD，group-name 必须在 group-symbol 前面
    xmlLines.push('    <part-group type="start" number="1">');
    xmlLines.push("      <group-name>Choir</group-name>");
    xmlLines.push("      <group-symbol>bracket</group-symbol>");
    xmlLines.push("    </part-group>");

    const voiceMeta: Array<{ id: string; name: string; abbr: string; ch: number }> = [
      { id: "P1", name: "Soprano", abbr: "S", ch: 1 },
      { id: "P2", name: "Alto", abbr: "A", ch: 2 },
      { id: "P3", name: "Tenor", abbr: "T", ch: 3 },
      { id: "P4", name: "Bass", abbr: "B", ch: 4 },
    ];
    for (const v of voiceMeta) {
      xmlLines.push(`    <score-part id="${v.id}">`);
      xmlLines.push(`      <part-name>${v.name}</part-name>`);
      xmlLines.push(`      <part-abbreviation>${v.abbr}</part-abbreviation>`);
      xmlLines.push(`      <score-instrument id="${v.id}-I1">`);
      xmlLines.push(`        <instrument-name>${v.name}</instrument-name>`);
      xmlLines.push("      </score-instrument>");
      xmlLines.push(`      <midi-instrument id="${v.id}-I1">`);
      xmlLines.push(`        <midi-channel>${v.ch}</midi-channel>`);
      xmlLines.push("        <midi-program>53</midi-program>");
      xmlLines.push("      </midi-instrument>");
      xmlLines.push("    </score-part>");
    }
    xmlLines.push('    <part-group type="stop" number="1"/>');
  }

  for (const { track, id, channel } of auxiliaryParts) {
    const instrumentId = `${id}-I1`;
    const name = xmlEscape(track.name);
    xmlLines.push(`    <score-part id="${id}">`);
    xmlLines.push(`      <part-name>${name}</part-name>`);
    xmlLines.push(`      <part-abbreviation>${xmlEscape(track.shortName)}</part-abbreviation>`);
    xmlLines.push(`      <score-instrument id="${instrumentId}">`);
    xmlLines.push(`        <instrument-name>${name}</instrument-name>`);
    xmlLines.push("      </score-instrument>");
    xmlLines.push(`      <midi-instrument id="${instrumentId}">`);
    xmlLines.push(`        <midi-channel>${channel}</midi-channel>`);
    xmlLines.push(`        <midi-program>${track.program + 1}</midi-program>`);
    xmlLines.push("      </midi-instrument>");
    xmlLines.push("    </score-part>");
  }
  xmlLines.push("  </part-list>");

  // Pre-sort all chords and tempo events
  const allChords = [...project.chordTrack.regions].sort(
    (a, b) => a.startTick - b.startTick,
  );
  const allTempos = [...(project.tempoEvents ?? [])].sort(
    (a, b) => a.tick - b.tick,
  );

  // Parts content
  if (options.layout === "single-staff") {
    // 单轨单谱表 (1 Part, 1 Staff, 4 Voices)
    xmlLines.push('  <part id="P1">');
    scoreModel.measures.forEach((measure, measureIndex) => {
      const prevMeasure =
        measureIndex > 0 ? scoreModel.measures[measureIndex - 1] : undefined;
      xmlLines.push(`    <measure number="${measure.number}">`);

      appendMeasureAttributes(xmlLines, measure, prevMeasure, project.ppq, ["treble"]);
      appendTempoDirections(xmlLines, measure, measureIndex === 0, allTempos);

      // Chords on Voice 1 (Above)
      const chordsInMeasure = allChords.filter(
        (c) => c.startTick >= measure.fromTick && c.startTick < measure.toTick,
      );
      chordsInMeasure.forEach((chordRegion) => {
        const offsetTicks = chordRegion.startTick - measure.fromTick;
        const formatted = formatChordRegion(project, chordRegion);

        if (options.includeChords && formatted.absolute) {
          xmlLines.push('      <direction placement="above">');
          xmlLines.push("        <direction-type>");
          xmlLines.push(
            `          <words font-family="sans-serif" font-size="10" font-weight="bold">${xmlEscape(formatted.absolute)}</words>`,
          );
          xmlLines.push("        </direction-type>");
          if (offsetTicks > 0) {
            xmlLines.push(`        <offset>${offsetTicks}</offset>`);
          }
          xmlLines.push("        <voice>1</voice>");
          xmlLines.push("        <staff>1</staff>");
          xmlLines.push("      </direction>");
        }
      });

      const measureDuration = measure.toTick - measure.fromTick;

      // Voice 1: Soprano
      measure.voices.soprano.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 1, 1, "up"));
      });

      // Voice 2: Alto
      xmlLines.push("      <backup>");
      xmlLines.push(`        <duration>${measureDuration}</duration>`);
      xmlLines.push("      </backup>");
      measure.voices.alto.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 2, 1, "down"));
      });

      // Voice 3: Tenor
      xmlLines.push("      <backup>");
      xmlLines.push(`        <duration>${measureDuration}</duration>`);
      xmlLines.push("      </backup>");
      measure.voices.tenor.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 3, 1, "up"));
      });

      // Voice 4: Bass
      xmlLines.push("      <backup>");
      xmlLines.push(`        <duration>${measureDuration}</duration>`);
      xmlLines.push("      </backup>");

      // Functional / Roman Analysis on Voice 4 (Below)
      chordsInMeasure.forEach((chordRegion) => {
        const offsetTicks = chordRegion.startTick - measure.fromTick;
        const formatted = formatChordRegion(project, chordRegion);
        const analysisLabel = getAnalysisLabel(project, formatted);

        if (options.includeRomanNumerals && analysisLabel) {
          xmlLines.push('      <direction placement="below">');
          xmlLines.push("        <direction-type>");
          xmlLines.push(
            `          <words font-family="Times New Roman, serif" font-size="11" font-weight="bold">${xmlEscape(analysisLabel)}</words>`,
          );
          xmlLines.push("        </direction-type>");
          if (offsetTicks > 0) {
            xmlLines.push(`        <offset>${offsetTicks}</offset>`);
          }
          xmlLines.push("        <voice>4</voice>");
          xmlLines.push("        <staff>1</staff>");
          xmlLines.push("      </direction>");
        }
      });

      measure.voices.bass.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 4, 1, "down"));
      });

      xmlLines.push("    </measure>");
    });
    xmlLines.push("  </part>");
  } else if (options.layout === "grand-staff") {
    // 双轨大谱表 (1 Part, 2 Staves, 4 Voices)
    xmlLines.push('  <part id="P1">');
    scoreModel.measures.forEach((measure, measureIndex) => {
      const prevMeasure =
        measureIndex > 0 ? scoreModel.measures[measureIndex - 1] : undefined;
      xmlLines.push(`    <measure number="${measure.number}">`);

      appendMeasureAttributes(xmlLines, measure, prevMeasure, project.ppq, ["treble", "bass"]);
      appendTempoDirections(xmlLines, measure, measureIndex === 0, allTempos);

      // Chord Annotations on Staff 1 (Above Voice 1)
      const chordsInMeasure = allChords.filter(
        (c) => c.startTick >= measure.fromTick && c.startTick < measure.toTick,
      );
      chordsInMeasure.forEach((chordRegion) => {
        const offsetTicks = chordRegion.startTick - measure.fromTick;
        const formatted = formatChordRegion(project, chordRegion);

        if (options.includeChords && formatted.absolute) {
          xmlLines.push('      <direction placement="above">');
          xmlLines.push("        <direction-type>");
          xmlLines.push(
            `          <words font-family="sans-serif" font-size="10" font-weight="bold">${xmlEscape(formatted.absolute)}</words>`,
          );
          xmlLines.push("        </direction-type>");
          if (offsetTicks > 0) {
            xmlLines.push(`        <offset>${offsetTicks}</offset>`);
          }
          xmlLines.push("        <voice>1</voice>");
          xmlLines.push("        <staff>1</staff>");
          xmlLines.push("      </direction>");
        }
      });

      const measureDuration = measure.toTick - measure.fromTick;

      // Voice 1: Soprano (Staff 1, Voice 1, Stem Up)
      measure.voices.soprano.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 1, 1, "up"));
      });

      // Backup for Voice 2: Alto (Staff 1, Voice 2, Stem Down)
      xmlLines.push("      <backup>");
      xmlLines.push(`        <duration>${measureDuration}</duration>`);
      xmlLines.push("      </backup>");
      measure.voices.alto.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 2, 1, "down"));
      });

      // Backup for Voice 3: Tenor (Staff 2, Voice 3, Stem Up)
      xmlLines.push("      <backup>");
      xmlLines.push(`        <duration>${measureDuration}</duration>`);
      xmlLines.push("      </backup>");
      measure.voices.tenor.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 3, 2, "up"));
      });

      // Backup for Voice 4: Bass (Staff 2, Voice 4, Stem Down)
      xmlLines.push("      <backup>");
      xmlLines.push(`        <duration>${measureDuration}</duration>`);
      xmlLines.push("      </backup>");

      // Functional / Roman Analysis on Staff 2 (Below Voice 4)
      chordsInMeasure.forEach((chordRegion) => {
        const offsetTicks = chordRegion.startTick - measure.fromTick;
        const formatted = formatChordRegion(project, chordRegion);
        const analysisLabel = getAnalysisLabel(project, formatted);

        if (options.includeRomanNumerals && analysisLabel) {
          xmlLines.push('      <direction placement="below">');
          xmlLines.push("        <direction-type>");
          xmlLines.push(
            `          <words font-family="Times New Roman, serif" font-size="11" font-weight="bold">${xmlEscape(analysisLabel)}</words>`,
          );
          xmlLines.push("        </direction-type>");
          if (offsetTicks > 0) {
            xmlLines.push(`        <offset>${offsetTicks}</offset>`);
          }
          xmlLines.push("        <voice>4</voice>");
          xmlLines.push("        <staff>2</staff>");
          xmlLines.push("      </direction>");
        }
      });

      measure.voices.bass.events.forEach((ev) => {
        xmlLines.push(formatEventXml(ev, 4, 2, "down"));
      });

      xmlLines.push("    </measure>");
    });
    xmlLines.push("  </part>");
  } else {
    // 四轨独立分谱 (4 Parts: P1..P4)
    const voiceConfigs: Array<{
      partId: string;
      voiceId: VoiceId;
      clef: ScoreStaff;
    }> = [
      { partId: "P1", voiceId: "soprano", clef: "treble" },
      { partId: "P2", voiceId: "alto", clef: "treble" },
      { partId: "P3", voiceId: "tenor", clef: "bass" },
      { partId: "P4", voiceId: "bass", clef: "bass" },
    ];

    voiceConfigs.forEach(({ partId, voiceId, clef }) => {
      xmlLines.push(`  <part id="${partId}">`);
      scoreModel.measures.forEach((measure, measureIndex) => {
        const prevMeasure =
          measureIndex > 0 ? scoreModel.measures[measureIndex - 1] : undefined;
        xmlLines.push(`    <measure number="${measure.number}">`);

        appendMeasureAttributes(xmlLines, measure, prevMeasure, project.ppq, [clef]);
        if (partId === "P1") appendTempoDirections(xmlLines, measure, measureIndex === 0, allTempos);

        // Chords on Part 1 (Soprano)
        const chordsInMeasure = allChords.filter(
          (c) => c.startTick >= measure.fromTick && c.startTick < measure.toTick,
        );
        chordsInMeasure.forEach((chordRegion) => {
          const offsetTicks = chordRegion.startTick - measure.fromTick;
          const formatted = formatChordRegion(project, chordRegion);

          if (partId === "P1" && options.includeChords && formatted.absolute) {
            xmlLines.push('      <direction placement="above">');
            xmlLines.push("        <direction-type>");
            xmlLines.push(
              `          <words font-family="sans-serif" font-size="10" font-weight="bold">${xmlEscape(formatted.absolute)}</words>`,
            );
            xmlLines.push("        </direction-type>");
            if (offsetTicks > 0) {
              xmlLines.push(`        <offset>${offsetTicks}</offset>`);
            }
            xmlLines.push("        <voice>1</voice>");
            xmlLines.push("        <staff>1</staff>");
            xmlLines.push("      </direction>");
          }

          if (partId === "P4" && options.includeRomanNumerals) {
            const analysisLabel = getAnalysisLabel(project, formatted);
            if (analysisLabel) {
              xmlLines.push('      <direction placement="below">');
              xmlLines.push("        <direction-type>");
              xmlLines.push(
                `          <words font-family="Times New Roman, serif" font-size="11" font-weight="bold">${xmlEscape(analysisLabel)}</words>`,
              );
              xmlLines.push("        </direction-type>");
              if (offsetTicks > 0) {
                xmlLines.push(`        <offset>${offsetTicks}</offset>`);
              }
              xmlLines.push("        <voice>1</voice>");
              xmlLines.push("        <staff>1</staff>");
              xmlLines.push("      </direction>");
            }
          }
        });

        const events = measure.voices[voiceId].events;
        events.forEach((ev) => {
          xmlLines.push(formatEventXml(ev, 1, 1, "up"));
        });

        xmlLines.push("    </measure>");
      });
      xmlLines.push("  </part>");
    });
  }

  auxiliaryParts.forEach(({ id }, trackIndex) => {
    xmlLines.push(`  <part id="${id}">`);
    scoreModel.measures.forEach((measure, measureIndex) => {
      const staff = measure.auxiliaryStaves[trackIndex];
      xmlLines.push(`    <measure number="${measure.number}">`);
      appendMeasureAttributes(
        xmlLines,
        measure,
        scoreModel.measures[measureIndex - 1],
        project.ppq,
        [staff.clef],
      );
      appendAuxiliaryStaff(xmlLines, staff, measure.toTick - measure.fromTick);
      xmlLines.push("    </measure>");
    });
    xmlLines.push("  </part>");
  });

  xmlLines.push("</score-partwise>");
  return xmlLines.join("\n");
}
