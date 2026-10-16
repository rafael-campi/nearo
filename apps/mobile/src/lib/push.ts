import type { RegisterDeviceToken } from '@despacho/shared';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';
import { PUSH_TOKEN_KEY } from './push-unregister';
import { useSession } from './session';

// Com o app aberto, o push também aparece como aviso.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Pede permissão e devolve o token do aparelho (FCM no Android). null se negado ou indisponível. */
async function deviceToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Despacho', importance: Notifications.AndroidImportance.HIGH });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const { data } = await Notifications.getDevicePushTokenAsync();
  return typeof data === 'string' ? data : null;
}

/**
 * Enquanto há sessão: registra o token do aparelho na API (e o atualiza se mudar) e abre a tela certa
 * quando a pessoa toca num push.
 */
export function usePushRegistration() {
  const sessionToken = useSession((s) => s.token);

  useEffect(() => {
    if (!sessionToken) return;
    let active = true;
    void (async () => {
      try {
        const token = await deviceToken();
        if (!token || !active) return;
        const body: RegisterDeviceToken = { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
        await api('/my/device-token', { method: 'PUT', body });
        await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
      } catch {
        // Push é um complemento: sem ele, o app segue com o socket e a lista de atualizações.
      }
    })();

    // O token pode mudar com o tempo: registra o novo.
    const refresh = Notifications.addPushTokenListener(({ data }) => {
      if (typeof data !== 'string') return;
      const body: RegisterDeviceToken = { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
      void api('/my/device-token', { method: 'PUT', body })
        .then(() => SecureStore.setItemAsync(PUSH_TOKEN_KEY, data))
        .catch(() => undefined);
    });
    return () => {
      active = false;
      refresh.remove();
    };
  }, [sessionToken]);

  // Tocar no push abre a tela certa, também quando o app estava fechado (a última resposta chega ao abrir).
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!sessionToken || !lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (id === handledResponse) return;
    handledResponse = id;
    openFromPush(lastResponse.notification.request.content.data);
  }, [sessionToken, lastResponse]);
}

// Cada toque é tratado uma vez, mesmo que o hook entregue a mesma resposta de novo.
let handledResponse: string | null = null;

/** Mensagem nova abre a conversa; qualquer outro aviso abre a lista de atualizações. */
function openFromPush(data: Record<string, unknown> | undefined): void {
  const { type, serviceRequestId, companyId, role } = data ?? {};
  if (type === 'new_message' && typeof serviceRequestId === 'string' && typeof companyId === 'string' && (role === 'client' || role === 'provider')) {
    router.push({ pathname: '/chat/[id]', params: { id: serviceRequestId, companyId, as: role } });
    return;
  }
  router.push('/notifications');
}
