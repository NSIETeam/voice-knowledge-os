import { create } from "zustand";
import type { DiarizeEngine } from "../../lib/ipc";
import { EMPTY_DIARIZE_STATE, type DiarizeState } from "./types";

type Update = DiarizeState | ((previous: DiarizeState) => DiarizeState);
type Store = {
  models: Record<DiarizeEngine, DiarizeState>;
  revisions: Record<DiarizeEngine, number>;
  update: (engine: DiarizeEngine, update: Update) => void;
};

// Download promises outlive Settings. Their completion must update shared
// state, not an unmounted component; reopening must not offer a second writer.
export const useDiarizeStore = create<Store>((set) => ({
  models: { community1: { ...EMPTY_DIARIZE_STATE }, sortformer: { ...EMPTY_DIARIZE_STATE }, nemotron3: { ...EMPTY_DIARIZE_STATE } },
  revisions: { community1: 0, sortformer: 0, nemotron3: 0 },
  update: (engine, update) => set((state) => ({
    models: { ...state.models, [engine]: typeof update === "function" ? update(state.models[engine]) : update },
    revisions: { ...state.revisions, [engine]: state.revisions[engine] + 1 },
  })),
}));

export const setDiarize = (update: Update) => useDiarizeStore.getState().update("community1", update);
export const setSortformer = (update: Update) => useDiarizeStore.getState().update("sortformer", update);
export const setNemotron3 = (update: Update) => useDiarizeStore.getState().update("nemotron3", update);
