// @vitest-environment jsdom

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import * as inference from "../../domain/harmony/inference";
import { createEmptyProject } from "../../domain/project";
import { logger } from "../../services/logging";
import { ChordInferenceDialog } from "./ChordInferenceDialog";

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
