import { describe, expect, it, vi } from "vitest";
import { MAX_MIDI_IMPORT_BYTES } from "../../shared/desktop";
import { compileScoreText } from "../domain/scoreText";
import { autosaveProject, findRecovery, openMidiFile, openProject, readSoundFontBuffer, saveProject } from "./desktop";

it("保存、恢复和通过桌面桥接重开保留倍增三四与实写音符", async () => {
  const { project } = compileScoreText(`satb 1
key C major
meter 2/4
bars 1..1 {
 S: | D#5/4 E5/4 |
 A: | F#4/4 G4/4 |
 T: | C4/2 |
 B: | Ab2/4 G2/4 |
 H: | DD++43/4 K46/4 |
}`);
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  vi.stubGlobal("window", {});
  try {
    await autosaveProject(project, "round/a.satb");
    const recovery = await findRecovery();
    expect(recovery?.sourcePath).toBe("round/a.satb");
    expect(recovery?.project.chordTrack.regions).toEqual(project.chordTrack.regions);
    await saveProject(project);
    const browser = await openProject();
    expect(browser?.project.chordTrack.regions).toEqual(project.chordTrack.regions);
    expect(browser?.project.satbTracks).toEqual(project.satbTracks);
    expect(await findRecovery()).toBeUndefined();
    // Exercise the renderer end of the Electron open contract on the saved JSON.
    vi.stubGlobal("window", {
      desktop: { project: { open: async () => ({
        canceled: false, project: JSON.parse(memory.get("satb-master-browser-project")!), filePath: "round/a.satb",
      }) } },
    });
    const desktop = await openProject();
    expect(desktop?.filePath).toBe("round/a.satb");
    expect(desktop?.project.chordTrack.regions).toEqual(project.chordTrack.regions);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("browser MIDI file picker", () => {
  async function chooseMidi(file?: File) {
    const input = new EventTarget();
    Object.assign(input, {
      type: "",
      accept: "",
      oncancel: null,
      files: file ? [file] : [],
      click() { input.dispatchEvent(new Event(file ? "change" : "cancel")); },
    });
    const createElement = vi.fn().mockReturnValue(input);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("window", new EventTarget());
    try {
      const result = openMidiFile();
      expect(createElement).toHaveBeenCalledWith("input");
      expect(input).toMatchObject({ type: "file", accept: ".mid,.midi" });
      return await result;
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("settles with no file when the picker is canceled", async () => {
    await expect(chooseMidi()).resolves.toBeUndefined();
  });

  it("returns the chosen file name and bytes", async () => {
    const bytes = Uint8Array.of(77, 84, 104, 100);
    await expect(chooseMidi(new File([bytes], "练习.midi"))).resolves.toEqual({
      fileName: "练习.midi", bytes,
    });
  });

  it.each([
    [0, "MIDI 文件为空"],
    [MAX_MIDI_IMPORT_BYTES + 1, "MIDI 文件超过 10 MB 限制"],
  ])("rejects a file of %i bytes before reading it", async (size, message) => {
    const file = new File([new Uint8Array(size)], "invalid.mid");
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(chooseMidi(file)).rejects.toThrow(message);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("SoundFont streaming reader", () => {
  it("assembles streamed bytes into one exact-sized ArrayBuffer", async () => {
    const progress: number[] = [];
    const buffer = await readSoundFontBuffer(
      "data:application/octet-stream;base64,AQIDBA==",
      4,
      (processedBytes) => progress.push(processedBytes),
    );

    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4]);
    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(4);
  });

  it("rejects data that no longer matches the preflight size", async () => {
    await expect(
      readSoundFontBuffer("data:application/octet-stream;base64,AQIDBA==", 3),
    ).rejects.toThrow("文件大小在加载过程中发生了变化");
  });
});
