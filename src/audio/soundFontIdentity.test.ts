import { describe, expect, it } from "vitest";
import {
  soundFontId,
  soundFontLoadKey,
  type SoundFontReference,
} from "./soundFontIdentity";

describe("SoundFont identity", () => {
  it("treats all references to the bundled default bank as the same source", () => {
    expect(soundFontId({ kind: "default", name: "默认音色" })).toBe(
      soundFontId({ kind: "default", name: "Default SoundFont" }),
    );
  });

  it("uses content hash before path or display name for local banks", () => {
    const first: SoundFontReference = {
      kind: "user",
      name: "Choir.sf2",
      path: "C:\\Sounds\\Choir.sf2",
      hash: "same-content",
    };
    const moved = {
      ...first,
      name: "Renamed.sf2",
      path: "D:\\Banks\\Renamed.sf2",
    };

    expect(soundFontId(first)).toBe(soundFontId(moved));
  });

  it("falls back to the local path when a legacy reference has no hash", () => {
    expect(
      soundFontId({
        kind: "user",
        name: "Choir.sf2",
        path: "C:\\Sounds\\Choir.sf2",
      }),
    ).toBe("user:C:\\Sounds\\Choir.sf2");
  });

  it("keeps identical references stable but permits retrying from a new path", () => {
    const source: SoundFontReference = {
      kind: "user",
      name: "Choir.sf2",
      path: "C:\\Sounds\\Choir.sf2",
      hash: "same-content",
    };

    expect(soundFontLoadKey({ ...source })).toBe(soundFontLoadKey(source));
    expect(soundFontLoadKey({ ...source, path: "D:\\Choir.sf2" })).not.toBe(
      soundFontLoadKey(source),
    );
  });
});
