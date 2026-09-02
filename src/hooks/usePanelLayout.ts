import { useCallback, useEffect, useMemo, useState } from "react";

export interface PanelSizes {
  left: number;
  right: number;
  bottom: number;
}

export interface PanelVisibility {
  left: boolean;
  right: boolean;
  bottom: boolean;
}

interface WorkspaceBounds {
  width: number;
  height: number;
}

interface MeasurableWorkspace {
  readonly isConnected: boolean;
  getBoundingClientRect(): Pick<DOMRect, "width" | "height">;
}

const STORAGE_KEY = "satb-master-panel-layout-v2";
const VISIBILITY_STORAGE_KEY = "satb-master-panel-visibility-v1";
export type PanelLayoutScope = "project" | "rule-test";

export function panelLayoutStorageKey(scope: PanelLayoutScope) {
  return `${STORAGE_KEY}:${scope}`;
}

export function panelVisibilityStorageKey(scope: PanelLayoutScope) {
  return `${VISIBILITY_STORAGE_KEY}:${scope}`;
}

export const PANEL_RESIZER_SIZE = 6;
export const DEFAULT_PANEL_SIZES: PanelSizes = {
  left: 184,
  right: 268,
  bottom: 182,
};
export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  left: true,
  right: true,
  bottom: true,
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

export function measureWorkspaceBounds(
  workspace: MeasurableWorkspace,
): WorkspaceBounds | undefined {
  if (!workspace.isConnected) return undefined;
  const { width, height } = workspace.getBoundingClientRect();
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

function readStoredPanelSizes(scope: PanelLayoutScope): PanelSizes {
  if (typeof window === "undefined") return DEFAULT_PANEL_SIZES;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(panelLayoutStorageKey(scope)) ?? "",
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

export function readStoredPanelVisibility(
  scope: PanelLayoutScope,
): PanelVisibility {
  if (typeof window === "undefined") return DEFAULT_PANEL_VISIBILITY;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(panelVisibilityStorageKey(scope)) ?? "",
    ) as Partial<PanelVisibility>;
    if (
      typeof stored.left === "boolean" &&
      typeof stored.right === "boolean" &&
      typeof stored.bottom === "boolean"
    ) {
      return stored as PanelVisibility;
    }
  } catch {
    // 忽略异常
  }
  return DEFAULT_PANEL_VISIBILITY;
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

export function usePanelLayout(scope: PanelLayoutScope = "project") {
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null);
  const workspaceRef = useCallback((node: HTMLDivElement | null) => {
    setWorkspace(node);
  }, []);
  const initialBounds = useMemo(viewportWorkspaceBounds, []);
  const [bounds, setBounds] = useState(initialBounds);
  const [preferredSizes, setPreferredSizes] = useState(() =>
    fitPanelSizes(readStoredPanelSizes(scope), {
      width: 10_000,
      height: 10_000,
    }),
  );
  const sizes = useMemo(
    () => fitPanelSizes(preferredSizes, bounds),
    [bounds, preferredSizes],
  );

  useEffect(() => {
    if (!workspace) return;
    const updateBounds = () => {
      const nextBounds = measureWorkspaceBounds(workspace);
      if (nextBounds) setBounds(nextBounds);
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
  }, [workspace]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        panelLayoutStorageKey(scope),
        JSON.stringify(preferredSizes),
      );
    } catch {
      // 受限环境下无法持久化时，当前会话内的尺寸调整仍然有效。
    }
  }, [preferredSizes, scope]);

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

  const [visibility, setVisibility] = useState<PanelVisibility>(() =>
    readStoredPanelVisibility(scope),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        panelVisibilityStorageKey(scope),
        JSON.stringify(visibility),
      );
    } catch {
      // 忽略存储异常
    }
  }, [visibility, scope]);

  const toggleLeft = useCallback(() => {
    setVisibility((current) => ({ ...current, left: !current.left }));
  }, []);

  const toggleRight = useCallback(() => {
    setVisibility((current) => ({ ...current, right: !current.right }));
  }, []);

  const toggleBottom = useCallback(() => {
    setVisibility((current) => ({ ...current, bottom: !current.bottom }));
  }, []);

  const setLeftVisible = useCallback((visible: boolean) => {
    setVisibility((current) => ({ ...current, left: visible }));
  }, []);

  const setRightVisible = useCallback((visible: boolean) => {
    setVisibility((current) => ({ ...current, right: visible }));
  }, []);

  const setBottomVisible = useCallback((visible: boolean) => {
    setVisibility((current) => ({ ...current, bottom: visible }));
  }, []);

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

  return {
    workspaceRef,
    sizes,
    limits,
    visibility,
    toggleLeft,
    toggleRight,
    toggleBottom,
    setLeftVisible,
    setRightVisible,
    setBottomVisible,
    setLeft,
    setRight,
    setBottom,
  };
}
