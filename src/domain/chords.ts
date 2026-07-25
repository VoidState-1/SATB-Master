import {
  KEY_NAMES,
  type ChordAnalysis,
  type ChordQuality,
  type ChordRegion,
  type KeyEvent,
  type ProjectDocument,
} from './model'
import { keyAtTick } from './time'

export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  halfDiminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9],
}

const DEGREE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const
const ROMAN_DEGREES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11]

export type ChordFunction = 'tonic' | 'subdominant' | 'dominant' | 'other'

export interface FormattedChordName {
  roman: string
  absolute: string
  functionLabel: string
  spokenDescription: string
}

function pitchClass(value: number) {
  return ((value % 12) + 12) % 12
}

function accidentalPrefix(value: number) {
  if (value < 0) return '♭'.repeat(-value)
  if (value > 0) return '♯'.repeat(value)
  return ''
}

function signedPitchDifference(target: number, natural: number) {
  let difference = pitchClass(target - natural)
  if (difference > 6) difference -= 12
  return difference
}

function spellPitch(pitch: number, letterIndex: number) {
  const normalizedLetter = ((letterIndex % 7) + 7) % 7
  const difference = signedPitchDifference(pitch, NATURAL_PITCH_CLASSES[normalizedLetter])
  return `${LETTERS[normalizedLetter]}${accidentalPrefix(difference)}`
}

function tonicLetterIndex(key: KeyEvent) {
  const tonicName = KEY_NAMES[key.tonic] ?? 'C'
  return Math.max(0, LETTERS.indexOf(tonicName[0]))
}

function analysisContext(analysis: ChordAnalysis, key: KeyEvent) {
  if (!analysis.appliedToDegree) return key
  const targetIndex = analysis.appliedToDegree - 1
  return {
    ...key,
    tonic: pitchClass(key.tonic + DEGREE_INTERVALS[key.mode][targetIndex]),
    mode: 'major' as const,
  }
}

export function isSeventhChord(quality: ChordQuality) {
  return QUALITY_INTERVALS[quality].length === 4
}

export function chordRootPitchClass(analysis: ChordAnalysis, key: KeyEvent) {
  const context = analysisContext(analysis, key)
  return pitchClass(context.tonic + DEGREE_INTERVALS[context.mode][analysis.degree - 1] + analysis.accidental)
}

export function chordPitchClasses(analysis: ChordAnalysis, key: KeyEvent) {
  const root = chordRootPitchClass(analysis, key)
  return QUALITY_INTERVALS[analysis.quality].map((interval) => pitchClass(root + interval))
}

export function chordFunction(analysis: ChordAnalysis): ChordFunction {
  if (analysis.appliedToDegree && [5, 7].includes(analysis.degree)) return 'dominant'
  if ([1, 3, 6].includes(analysis.degree)) return 'tonic'
  if ([2, 4].includes(analysis.degree)) return 'subdominant'
  if ([5, 7].includes(analysis.degree)) return 'dominant'
  return 'other'
}

function romanName(analysis: ChordAnalysis) {
  const uppercase = ['major', 'augmented', 'dominant7', 'major7'].includes(analysis.quality)
  const numeral = uppercase ? ROMAN_DEGREES[analysis.degree - 1] : ROMAN_DEGREES[analysis.degree - 1].toLowerCase()
  const qualityMark = analysis.quality === 'augmented'
    ? '+'
    : analysis.quality === 'diminished' || analysis.quality === 'diminished7'
      ? '°'
      : analysis.quality === 'halfDiminished7' ? 'ø' : ''
  const figures = isSeventhChord(analysis.quality)
    ? ['7', '6/5', '4/3', '4/2'][analysis.inversion]
    : ['', '6', '6/4'][analysis.inversion]
  const target = analysis.appliedToDegree ? `/${ROMAN_DEGREES[analysis.appliedToDegree - 1]}` : ''
  return `${accidentalPrefix(analysis.accidental)}${numeral}${qualityMark}${figures}${target}`
}

function absoluteName(analysis: ChordAnalysis, key: KeyEvent) {
  const context = analysisContext(analysis, key)
  const rootPitch = chordRootPitchClass(analysis, key)
  const rootLetter = tonicLetterIndex(context) + analysis.degree - 1
  const root = spellPitch(rootPitch, rootLetter)
  const suffix: Record<ChordQuality, string> = {
    major: '',
    minor: 'm',
    diminished: '°',
    augmented: '+',
    dominant7: '7',
    major7: 'maj7',
    minor7: 'm7',
    halfDiminished7: 'ø7',
    diminished7: '°7',
  }
  if (analysis.inversion === 0) return `${root}${suffix[analysis.quality]}`
  const bassPitch = pitchClass(rootPitch + QUALITY_INTERVALS[analysis.quality][analysis.inversion])
  const bass = spellPitch(bassPitch, rootLetter + analysis.inversion * 2)
  return `${root}${suffix[analysis.quality]}/${bass}`
}

export function formatChord(analysis: ChordAnalysis, key: KeyEvent): FormattedChordName {
  const roman = romanName(analysis)
  const absolute = absoluteName(analysis, key)
  const functionName = chordFunction(analysis)
  const baseLabel = functionName === 'tonic' ? '主功能' : functionName === 'subdominant' ? '下属功能' : functionName === 'dominant' ? '属功能' : '其他功能'
  const functionLabel = analysis.appliedToDegree ? `${baseLabel} · 指向 ${ROMAN_DEGREES[analysis.appliedToDegree - 1]} 级` : baseLabel
  return { roman, absolute, functionLabel, spokenDescription: `${roman}，${absolute}，${functionLabel}` }
}

export function formatChordRegion(project: ProjectDocument, region: ChordRegion) {
  return formatChord(region.analysis, keyAtTick(project.keyEvents, region.startTick))
}

export function chordAtTick(project: ProjectDocument, tick: number) {
  return project.chordTrack.regions.find((region) => region.startTick <= tick && region.startTick + region.durationTicks > tick)
}

export function defaultChordAnalysisAtTick(project: ProjectDocument, tick: number): ChordAnalysis {
  const key = keyAtTick(project.keyEvents, tick)
  return { degree: 1, accidental: 0, quality: key.mode === 'major' ? 'major' : 'minor', inversion: 0 }
}
