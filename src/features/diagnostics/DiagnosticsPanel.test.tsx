// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { compileScoreText } from "../../domain/scoreText";
import { checkHarmony } from "../../domain/harmony/registry";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

it("展开低音错误可查两条原始提示，同拍独立交叉单列", async () => {
  const { project } = compileScoreText(`satb 1
key C major
bars 1..1 {
 S: | E5/1 |
 A: | E4/1 |
 T: | G4/1 |
 B: | F#2/1 |
 H: | I/1 |
}`);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onSelect = vi.fn(), onIgnore = vi.fn();
  try {
    await act(() => root.render(<DiagnosticsPanel project={project} result={checkHarmony(project)}
      onSelect={onSelect} onToggleIgnored={onIgnore} />));
    expect(container.querySelector(".diagnostics-counts")?.textContent).toContain("2 个错误 · 0 个警告");
    const details = container.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toBe("含 2 条连带提示");
    expect(details.open).toBe(false);
    await act(() => summary.click());
    expect(details.open).toBe(true);
    expect([...details.querySelectorAll("code")].map(node => node.textContent).sort())
      .toEqual(["chord.incomplete-members", "chord.unclassified-nonchord-tone"]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onIgnore).not.toHaveBeenCalled();
    await act(() => summary.click());
    expect(details.open).toBe(false);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
