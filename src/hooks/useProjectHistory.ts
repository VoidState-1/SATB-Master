import { useCallback, useReducer } from 'react'
import type { ProjectDocument } from '../domain/model'

interface Frame {
  project: ProjectDocument
  revision: number
}

interface HistoryState {
  past: Frame[]
  present: Frame
  future: Frame[]
  savedRevision: number
}

type HistoryAction =
  | { type: 'commit'; project: ProjectDocument }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; project: ProjectDocument }
  | { type: 'recover'; project: ProjectDocument }
  | { type: 'mark-saved' }

function reducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'commit': {
      const nextRevision = Math.max(
        state.present.revision,
        ...state.past.map((frame) => frame.revision),
        ...state.future.map((frame) => frame.revision),
      ) + 1
      return {
        ...state,
        past: [...state.past.slice(-99), state.present],
        present: { project: action.project, revision: nextRevision },
        future: [],
      }
    }
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      }
    }
    case 'load':
      return { past: [], present: { project: action.project, revision: 0 }, future: [], savedRevision: 0 }
    case 'recover':
      return { past: [], present: { project: action.project, revision: 1 }, future: [], savedRevision: 0 }
    case 'mark-saved':
      return { ...state, savedRevision: state.present.revision }
  }
}

export function useProjectHistory(initialProject: ProjectDocument) {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: { project: initialProject, revision: 0 },
    future: [],
    savedRevision: 0,
  })

  return {
    project: state.present.project,
    revision: state.present.revision,
    isDirty: state.present.revision !== state.savedRevision,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback((project: ProjectDocument) => dispatch({ type: 'commit', project }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    load: useCallback((project: ProjectDocument) => dispatch({ type: 'load', project }), []),
    recover: useCallback((project: ProjectDocument) => dispatch({ type: 'recover', project }), []),
    markSaved: useCallback(() => dispatch({ type: 'mark-saved' }), []),
  }
}
