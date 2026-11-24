import type { HarmonyDiagnostic } from "../../domain/harmony";

export function orderTracksForRendering<T extends { id: string }>(
  tracks: readonly T[],
  activeVoice: string,
): T[] {
  const nonActive = tracks.filter((track) => track.id !== activeVoice);
  const active = tracks.filter((track) => track.id === activeVoice);
  return [...nonActive, ...active];
}

const DIAGNOSTIC_PRIORITY: Record<HarmonyDiagnostic["severity"], number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
};

export const DIAGNOSTIC_LABEL: Record<HarmonyDiagnostic["severity"], string> = {
  error: "错误",
  warning: "警告",
  suggestion: "建议",
};

export function groupDiagnostics(
  diagnostics: HarmonyDiagnostic[],
  key: "noteIds" | "chordIds",
  role: "all" | "failure" | "involved" = "all",
) {
  const grouped = new Map<string, HarmonyDiagnostic[]>();
  diagnostics.forEach((diagnostic) => {
    const targetIds =
      role === "all" || !diagnostic.subjects
        ? diagnostic[key]
        : role === "failure"
          ? diagnostic.subjects.failure
            ? (diagnostic.subjects.failure[key] ?? [])
            : diagnostic[key]
          : [
              ...(diagnostic.subjects.origin?.[key] ?? []),
              ...(diagnostic.subjects.failure?.[key] ?? []),
            ];
    new Set(targetIds).forEach((targetId) => {
      const targetDiagnostics = grouped.get(targetId) ?? [];
      targetDiagnostics.push(diagnostic);
      grouped.set(targetId, targetDiagnostics);
    });
  });
  grouped.forEach((items) =>
    items.sort(
      (left, right) =>
        DIAGNOSTIC_PRIORITY[left.severity] -
        DIAGNOSTIC_PRIORITY[right.severity],
    ),
  );
  return grouped;
}

export function primaryDiagnostic(diagnostics: HarmonyDiagnostic[]) {
  return diagnostics.reduce<HarmonyDiagnostic | undefined>(
    (primary, diagnostic) =>
      !primary ||
      DIAGNOSTIC_PRIORITY[diagnostic.severity] <
        DIAGNOSTIC_PRIORITY[primary.severity]
        ? diagnostic
        : primary,
    undefined,
  );
}

export function isBlackKey(midiNote: number) {
  return [1, 3, 6, 8, 10].includes(((midiNote % 12) + 12) % 12);
}

export function noteName(midiNote: number) {
  const names = [
    "C",
    "C♯",
    "D",
    "E♭",
    "E",
    "F",
    "F♯",
    "G",
    "A♭",
    "A",
    "B♭",
    "B",
  ];
  return `${names[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
}
