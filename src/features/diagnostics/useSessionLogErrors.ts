import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isErrorLog, type LogEntry } from "../../../shared/logging";
import { getRecentDesktopLogs, subscribeToDesktopLogErrors } from "../../services/desktop";
import { logger } from "../../services/logging";

export function useSessionLogErrors(isReading: boolean) {
  const knownIds = useRef(new Set<string>());
  const [totalErrors, setTotalErrors] = useState(0);
  const [readErrors, setReadErrors] = useState(0);

  useEffect(() => {
    let active = true;
    const remember = (entry?: LogEntry) => {
      if (!entry || !isErrorLog(entry.level) || knownIds.current.has(entry.id)) return;
      knownIds.current.add(entry.id);
      setTotalErrors(knownIds.current.size);
    };
    const unsubscribeRenderer = logger.subscribe(remember);
    const unsubscribeDesktop = subscribeToDesktopLogErrors(remember);
    logger.getEntries().forEach(remember);
    void getRecentDesktopLogs().then(({ entries }) => {
      if (active) entries.forEach(remember);
    }).catch(() => {
      // Live events and the local buffer remain available.
    });
    return () => {
      active = false;
      unsubscribeRenderer();
      unsubscribeDesktop?.();
    };
  }, []);

  useLayoutEffect(() => {
    if (isReading) setReadErrors(totalErrors);
  }, [isReading, totalErrors]);

  return { hasErrors: totalErrors > 0, unreadErrorCount: isReading ? 0 : totalErrors - readErrors };
}
