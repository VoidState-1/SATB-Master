// @vitest-environment jsdom

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import * as inference from "../../domain/harmony/inference";
import { createEmptyProject } from "../../domain/project";
import { logger } from "../../services/logging";
import { ChordInferenceDialog } from "./ChordInferenceDialog";
import { compileScoreText } from "../../domain/scoreText";

it("默认写入外音角色，取消勾选后按用户选择应用", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onApply = vi.fn();
  const { project } = compileScoreText(`satb 1
key C major
bars 1..1 {
 S: | E5/4 D5/8 E5/8 E5/2 |
 A: | G4/1 |
 T: | C4/1 |
 B: | C3/1 |
}`);
  try {
    await act(() => root.render(<ChordInferenceDialog project={project} playheadTick={0}
      selectedNoteIds={new Set()} selectedChordIds={new Set()} onClose={vi.fn()} onApply={onApply} />));
    const label = [...container.querySelectorAll("label")].find(l => l.textContent.includes("非和弦音角色"));
    const checkbox = label!.querySelector("input")!;
    const apply = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(checkbox.checked).toBe(true);
    await act(() => apply.click());
    expect(onApply).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ writeNonChordToneRoles: true }));
    await act(() => checkbox.click());
    expect(checkbox.checked).toBe(false);
    await act(() => apply.click());
    expect(onApply).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ writeNonChordToneRoles: false }));
  } finally {
    await act(() => root.unmount());
    container.remove();
    logger.clear();
    vi.unstubAllGlobals();
  }
});

it("reports inference failure once and prevents applying an unavailable result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(inference, "inferHarmony").mockImplementation(() => { throw new Error("invalid input"); });
  const container = document.createElement("div");
  const root = createRoot(container);
  const onApply = vi.fn();
  try {
    await act(() => root.render(
      <StrictMode>
        <ChordInferenceDialog
          project={createEmptyProject()}
          playheadTick={0}
          selectedNoteIds={new Set()}
          selectedChordIds={new Set()}
          onClose={vi.fn()}
          onApply={onApply}
        />
      </StrictMode>,
    ));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("和弦推导失败");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(logger.getEntries()).toEqual([expect.objectContaining({
      level: "error", scope: "inference", code: "INFERENCE_FAILED",
      error: expect.objectContaining({ message: "invalid input" }),
      context: expect.objectContaining({ durationMs: expect.any(Number) }),
    })]);
    expect(onApply).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    logger.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
