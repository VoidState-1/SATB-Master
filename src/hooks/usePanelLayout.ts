import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface PanelSizes {
  left: number;
  right: number;
  bottom: number;
}

interface WorkspaceBounds {
  width: number;
  height: number;
}

const STORAGE_KEY = "satb-master-panel-layout-v1";
export const PANEL_RESIZER_SIZE = 6;
export const DEFAULT_PANEL_SIZES: PanelSizes = {
  left: 184,
  right: 268,
  bottom: 182,
};
export const PANEL_LIMITS = {
  left: { min: 156, max: 360 },
  right: { min: 220, max: 480 },
  bottom: { min: 96, max: 420 },
  editor: { minWidth: 360, minHeight: 220 },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function viewportWorkspaceBounds(): WorkspaceBounds {
  if (typeof window === "undefined") return { width: 1280, height: 720 };
  return {
    width: window.innerWidth,
    height: Math.max(0, window.innerHeight - 94),
  };
}

function readStoredPanelSizes(): PanelSizes {
  if (typeof window === "undefined") return DEFAULT_PANEL_SIZES;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "",
    ) as Partial<PanelSizes>;
    if (
      [stored.left, stored.right, stored.bottom].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    ) {
      return stored as PanelSizes;
    }
  } catch {
    // 损坏或来自旧版本的界面偏好不应阻止编辑器启动。
  }
  return DEFAULT_PANEL_SIZES;
}

export function fitPanelSizes(
  sizes: PanelSizes,
  bounds: WorkspaceBounds,
): PanelSizes {
  const horizontalBudget = Math.max(
    PANEL_LIMITS.left.min + PANEL_LIMITS.right.min,
    Math.floor(
      bounds.width - PANEL_LIMITS.editor.minWidth - PANEL_RESIZER_SIZE * 2,
    ),
  );
  let left = clamp(sizes.left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max);
  let right = clamp(
    sizes.right,
    PANEL_LIMITS.right.min,
    PANEL_LIMITS.right.max,
  );
  if (left + right > horizontalBudget) {
    // 窗口缩小时按两侧超出最小值的比例收缩，避免某一面板独自承担全部变化。
    const leftExtra = left - PANEL_LIMITS.left.min;
    const rightExtra = right - PANEL_LIMITS.right.min;
    const availableExtra = Math.max(
      0,
      horizontalBudget - PANEL_LIMITS.left.min - PANEL_LIMITS.right.min,
    );
    const extraTotal = leftExtra + rightExtra;
    const nextLeftExtra =
      extraTotal > 0
        ? Math.round((availableExtra * leftExtra) / extraTotal)
        : 0;
    left = PANEL_LIMITS.left.min + nextLeftExtra;
    right = horizontalBudget - left;
  }

  const bottomMax = Math.max(
    PANEL_LIMITS.bottom.min,
    Math.min(
      PANEL_LIMITS.bottom.max,
      Math.floor(
        bounds.height - PANEL_LIMITS.editor.minHeight - PANEL_RESIZER_SIZE,
      ),
    ),
  );
  return {
    left: Math.round(left),
    right: Math.round(right),
    bottom: Math.round(clamp(sizes.bottom, PANEL_LIMITS.bottom.min, bottomMax)),
  };
}

export function usePanelLayout() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const initialBounds = useMemo(viewportWorkspaceBounds, []);
  const [bounds, setBounds] = useState(initialBounds);
  const [preferredSizes, setPreferredSizes] = useState(() =>
    fitPanelSizes(readStoredPanelSizes(), { width: 10_000, height: 10_000 }),
  );
  const sizes = useMemo(
    () => fitPanelSizes(preferredSizes, bounds),
    [bounds, preferredSizes],
  );

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const updateBounds = () => {
      const rect = workspace.getBoundingClientRect();
      const nextBounds = { width: rect.width, height: rect.height };
      setBounds(nextBounds);
    };
    updateBounds();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateBounds);
    observer?.observe(workspace);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferredSizes));
    } catch {
      // 受限环境下无法持久化时，当前会话内的尺寸调整仍然有效。
    }
  }, [preferredSizes]);

  const horizontalBudget = Math.max(
    PANEL_LIMITS.left.min + PANEL_LIMITS.right.min,
    Math.floor(
      bounds.width - PANEL_LIMITS.editor.minWidth - PANEL_RESIZER_SIZE * 2,
    ),
  );
  const limits = {
    left: {
      min: PANEL_LIMITS.left.min,
      max: Math.max(
        PANEL_LIMITS.left.min,
        Math.min(PANEL_LIMITS.left.max, horizontalBudget - sizes.right),
      ),
    },
    right: {
      min: PANEL_LIMITS.right.min,
      max: Math.max(
        PANEL_LIMITS.right.min,
        Math.min(PANEL_LIMITS.right.max, horizontalBudget - sizes.left),
      ),
    },
    bottom: {
      min: PANEL_LIMITS.bottom.min,
      max: Math.max(
        PANEL_LIMITS.bottom.min,
        Math.min(
          PANEL_LIMITS.bottom.max,
          Math.floor(
            bounds.height - PANEL_LIMITS.editor.minHeight - PANEL_RESIZER_SIZE,
          ),
        ),
      ),
    },
  };

  const setLeft = useCallback(
    (left: number) =>
      setPreferredSizes((current) => ({
        ...current,
        left,
        right: sizes.right,
      })),
    [sizes.right],
  );
  const setRight = useCallback(
    (right: number) =>
      setPreferredSizes((current) => ({ ...current, left: sizes.left, right })),
    [sizes.left],
  );
  const setBottom = useCallback(
    (bottom: number) =>
      setPreferredSizes((current) => ({ ...current, bottom })),
    [],
  );

  return { workspaceRef, sizes, limits, setLeft, setRight, setBottom };
}
