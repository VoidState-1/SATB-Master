import type { ChordAnalysis, ChordQuality } from '../domain/model'

export const CHORD_DEGREE_OPTIONS: ReadonlyArray<{ value: ChordAnalysis['degree']; label: string }> = [
  { value: 1, label: 'I' },
  { value: 2, label: 'II' },
  { value: 3, label: 'III' },
  { value: 4, label: 'IV' },
  { value: 5, label: 'V' },
  { value: 6, label: 'VI' },
  { value: 7, label: 'VII' },
]

export const CHORD_ACCIDENTAL_OPTIONS: ReadonlyArray<{ value: ChordAnalysis['accidental']; label: string; title: string }> = [
  { value: -2, label: '♭♭', title: '重降' },
  { value: -1, label: '♭', title: '降' },
  { value: 0, label: '♮', title: '无变化音' },
  { value: 1, label: '♯', title: '升' },
  { value: 2, label: '♯♯', title: '重升' },
]

export const CHORD_QUALITY_OPTIONS: ReadonlyArray<{ value: ChordQuality; label: string; shortLabel: string }> = [
  { value: 'major', label: '大三和弦', shortLabel: '大三' },
  { value: 'minor', label: '小三和弦', shortLabel: '小三' },
  { value: 'diminished', label: '减三和弦', shortLabel: '减三' },
  { value: 'augmented', label: '增三和弦', shortLabel: '增三' },
  { value: 'dominant7', label: '属七和弦', shortLabel: '属七' },
  { value: 'major7', label: '大七和弦', shortLabel: '大七' },
  { value: 'minor7', label: '小七和弦', shortLabel: '小七' },
  { value: 'halfDiminished7', label: '半减七和弦', shortLabel: '半减七' },
  { value: 'diminished7', label: '减七和弦', shortLabel: '减七' },
]

export const CHORD_INVERSION_OPTIONS: ReadonlyArray<{ value: ChordAnalysis['inversion']; label: string }> = [
  { value: 0, label: '原位' },
  { value: 1, label: '一转' },
  { value: 2, label: '二转' },
  { value: 3, label: '三转' },
]

export const CHORD_APPLIED_OPTIONS: ReadonlyArray<{ value: ChordAnalysis['appliedToDegree']; label: string }> = [
  { value: undefined, label: '无' },
  ...CHORD_DEGREE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
]
