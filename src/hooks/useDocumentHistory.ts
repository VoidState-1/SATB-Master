import { useCallback, useReducer } from "react";

interface Frame<Document> {
  document: Document;
  revision: number;
}

interface HistoryState<Document> {
  past: Frame<Document>[];
  present: Frame<Document>;
  future: Frame<Document>[];
  savedRevision: number;
}

type HistoryAction<Document> =
  | { type: "commit"; document: Document }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; document: Document }
  | { type: "recover"; document: Document }
  | { type: "mark-saved" };

function reducer<Document>(
  state: HistoryState<Document>,
  action: HistoryAction<Document>,
): HistoryState<Document> {
  switch (action.type) {
    case "commit": {
      const nextRevision =
        Math.max(
          state.present.revision,
          ...state.past.map((frame) => frame.revision),
          ...state.future.map((frame) => frame.revision),
        ) + 1;
      return {
        ...state,
        past: [...state.past.slice(-99), state.present],
        present: { document: action.document, revision: nextRevision },
        future: [],
      };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    case "load":
      return {
        past: [],
        present: { document: action.document, revision: 0 },
        future: [],
        savedRevision: 0,
      };
    case "recover":
      return {
        past: [],
        present: { document: action.document, revision: 1 },
        future: [],
        savedRevision: 0,
      };
    case "mark-saved":
      return { ...state, savedRevision: state.present.revision };
  }
}

export function useDocumentHistory<Document>(initialDocument: Document) {
  const [state, dispatch] = useReducer(reducer<Document>, {
    past: [],
    present: { document: initialDocument, revision: 0 },
    future: [],
    savedRevision: 0,
  });

  return {
    document: state.present.document,
    revision: state.present.revision,
    isDirty: state.present.revision !== state.savedRevision,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback(
      (document: Document) => dispatch({ type: "commit", document }),
      [],
    ),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    load: useCallback(
      (document: Document) => dispatch({ type: "load", document }),
      [],
    ),
    recover: useCallback(
      (document: Document) => dispatch({ type: "recover", document }),
      [],
    ),
    markSaved: useCallback(() => dispatch({ type: "mark-saved" }), []),
  };
}
