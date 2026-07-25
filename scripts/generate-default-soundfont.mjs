import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BasicInstrument,
  BasicPreset,
  BasicSample,
  BasicSoundBank,
  GeneratorTypes,
  SampleTypes,
  SoundBankLoader,
} from 'spessasynth_core'

const SAMPLE_RATE = 44_100
const ROOT_KEYS = [48, 60, 72]
const KEY_RANGES = [[0, 54], [55, 66], [67, 127]]
const OUTPUT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/soundfonts')
const OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, 'default.sf2')
const HASH_PATH = path.join(OUTPUT_DIRECTORY, 'default.sf2.sha256')

const VOWELS = [
  {
    name: 'SATB Choir Aahs',
    program: 52,
    formants: [[800, 1], [1_150, 0.7], [2_900, 0.34]],
  },
  {
    name: 'SATB Voice Oohs',
    program: 53,
    formants: [[350, 1.1], [900, 0.58], [2_200, 0.24]],
  },
]

function midiFrequency(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12)
}

function formantGain(frequency, formants) {
  return formants.reduce((gain, [center, strength]) => {
    const width = Math.max(120, center * 0.2)
    return gain + strength * Math.exp(-0.5 * ((frequency - center) / width) ** 2)
  }, 0)
}

function createVowelCycle(rootKey, formants) {
  const expectedFrequency = midiFrequency(rootKey)
  const cycleLength = Math.round(SAMPLE_RATE / expectedFrequency)
  const actualFrequency = SAMPLE_RATE / cycleLength
  const harmonics = Math.min(24, Math.floor((SAMPLE_RATE / 2) / actualFrequency))
  const audio = new Float32Array(cycleLength)

  for (let frame = 0; frame < cycleLength; frame += 1) {
    const phase = (frame / cycleLength) * Math.PI * 2
    let value = 0
    for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
      const frequency = actualFrequency * harmonic
      const amplitude = (0.48 / harmonic) + (formantGain(frequency, formants) / Math.sqrt(harmonic))
      value += amplitude * Math.sin(phase * harmonic)
    }
    audio[frame] = value
  }

  const peak = audio.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0)
  for (let frame = 0; frame < audio.length; frame += 1) audio[frame] = (audio[frame] / peak) * 0.78

  // 一个周期必须以整数采样点闭合；音分修正补偿取整后的基频偏差，使各八度仍保持准确音高。
  const pitchCorrection = Math.round(-1_200 * Math.log2(actualFrequency / expectedFrequency))
  return { audio, pitchCorrection }
}

function addVowelPreset(bank, definition) {
  const instrument = new BasicInstrument()
  instrument.name = definition.name

  ROOT_KEYS.forEach((rootKey, index) => {
    const { audio, pitchCorrection } = createVowelCycle(rootKey, definition.formants)
    const sample = new BasicSample(
      `${definition.name} ${rootKey}`,
      SAMPLE_RATE,
      rootKey,
      pitchCorrection,
      SampleTypes.monoSample,
      0,
      audio.length,
    )
    sample.setAudioData(audio, SAMPLE_RATE)

    const zone = instrument.createZone(sample)
    zone.keyRange = { min: KEY_RANGES[index][0], max: KEY_RANGES[index][1] }
    zone.setGenerator(GeneratorTypes.sampleModes, 1)
    zone.setGenerator(GeneratorTypes.attackVolEnv, -3_500)
    zone.setGenerator(GeneratorTypes.releaseVolEnv, -1_900)
    zone.setGenerator(GeneratorTypes.reverbEffectsSend, 120)
  })

  const preset = new BasicPreset(bank)
  preset.name = definition.name
  preset.program = definition.program
  preset.bankMSB = 0
  preset.bankLSB = 0
  preset.createZone(instrument)
  bank.addCompletePresets([preset])
}

const bank = new BasicSoundBank('sf2')
bank.soundBankInfo = {
  name: 'SATB Master Basic Choir 1.0.0',
  creationDate: new Date('2026-07-25T00:00:00.000Z'),
  software: 'SATB Master deterministic SoundFont generator',
  soundEngine: 'E-mu 10K2',
  version: { major: 2, minor: 4 },
  engineer: 'SATB Master contributors',
  product: 'SATB Master Basic Choir',
  copyright: 'Copyright 2026 SATB Master contributors; MIT licensed',
  comment: 'Algorithmically generated additive waveforms; contains no third-party audio recordings.',
}

VOWELS.forEach((definition) => addVowelPreset(bank, definition))
bank.flush()

const soundFont = bank.writeSF2({
  software: 'SATB Master SoundFont Generator 1.0.0',
  writeDefaultModulators: true,
  writeExtendedLimits: false,
})
const parsed = SoundBankLoader.fromArrayBuffer(soundFont)
const programs = parsed.presets.map((preset) => preset.program).sort((a, b) => a - b)
if (programs.join(',') !== '52,53' || parsed.samples.length !== ROOT_KEYS.length * VOWELS.length) {
  throw new Error(`生成的 SF2 结构无效：programs=${programs.join(',')} samples=${parsed.samples.length}`)
}

const bytes = new Uint8Array(soundFont)
const hash = createHash('sha256').update(bytes).digest('hex')
await mkdir(OUTPUT_DIRECTORY, { recursive: true })
await writeFile(OUTPUT_PATH, bytes)
await writeFile(HASH_PATH, `${hash}  default.sf2\n`, 'utf8')
console.log(`Generated ${OUTPUT_PATH} (${bytes.byteLength} bytes, sha256 ${hash})`)
