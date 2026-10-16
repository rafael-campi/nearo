import { create } from 'zustand';

export type AppMode = 'client' | 'provider';

/** Modo do app escolhido pela pessoa. null = ainda não escolheu (usa o padrão pelos vínculos). */
export const useMode = create<{ mode: AppMode | null; setMode(mode: AppMode): void }>((set) => ({
  mode: null,
  setMode: (mode) => set({ mode }),
}));
