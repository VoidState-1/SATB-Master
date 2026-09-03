import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PianoKeys } from "./PianoKeys";
import { MAX_MIDI, MIN_MIDI } from "../viewport";

describe("PianoKeys", () => {
  it("renders all 128 piano keys with data-midi and correct labels", () => {
    const html = renderToStaticMarkup(<PianoKeys height={2816} />);

    expect(html).toContain('class="piano-keys"');
    // 应当渲染 0 - 127 共 128 个键
    expect(html).toContain(`data-midi="${MAX_MIDI}"`);
    expect(html).toContain(`data-midi="${MIN_MIDI}"`);
    expect(html).toContain('data-midi="60"');

    // 中央 C (MIDI 60 = C4) 应当带有 C4 文本及 title
    expect(html).toContain('title="C4 (MIDI 60)"');
    expect(html).toContain(">C4</div>");

    // 黑键应当带有 black 类名
    expect(html).toContain('class="piano-key black "');
  });
});
