import { create } from 'zustand';
import { useMode } from './mode';
import { unregisterDeviceToken } from './push-unregister';
import { queryClient } from './query';
import { tokenStorage } from './token-storage';

interface SessionState {
  /** `loading` até ler o token guardado no aparelho. */
  status: 'loading' | 'signedOut' | 'signedIn';
  token: string | null;
  /** Código de acesso aberto por link antes do login; usado logo depois de entrar. */
  pendingJoinCode: string | null;
  hydrate(): Promise<void>;
  signIn(token: string): Promise<void>;
  signOut(): Promise<void>;
  setPendingJoinCode(code: string | null): void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  token: null,
  pendingJoinCode: null,
  async hydrate() {
    const token = await tokenStorage.get();
    set({ token, status: token ? 'signedIn' : 'signedOut' });
  },
  async signIn(token) {
    await tokenStorage.set(token);
    set({ token, status: 'signedIn' });
  },
  async signOut() {
    await unregisterDeviceToken(useSession.getState().token);
    await tokenStorage.clear();
    queryClient.clear();
    useMode.setState({ mode: null, promptedBaseLocation: false });
    set({ token: null, status: 'signedOut' });
  },
  setPendingJoinCode(code) {
    set({ pendingJoinCode: code });
  },
}));
