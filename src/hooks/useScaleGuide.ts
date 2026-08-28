import { useCallback, useState } from "react";

const STORAGE_KEY = "satb-master-scale-guide-v1";

function readScaleGuide() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useScaleGuide() {
  const [scaleGuideEnabled, setScaleGuideEnabledState] = useState(readScaleGuide);

  const setScaleGuideEnabled = useCallback((next: boolean) => {
    setScaleGuideEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore
    }
  }, []);

  return { scaleGuideEnabled, setScaleGuideEnabled };
}
