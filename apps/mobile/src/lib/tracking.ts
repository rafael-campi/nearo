import { GPS_INTERVAL_MS, type Coordinates } from '@despacho/shared';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { COMPANY_HEADER } from '@despacho/shared';
import { API_URL } from './config';
import { tokenStorage } from './token-storage';

// Envio da posição em segundo plano enquanto o pedido está a caminho (ADR 0005 e 0004: a tarefa roda
// mesmo com o app fechado, num serviço em primeiro plano no Android). Só o prestador, só a caminho.
const TASK = 'despacho.provider-tracking';
const TARGET_KEY = 'despacho.tracking-target';

interface Target {
  serviceRequestId: string;
  companyId: string;
}

async function readTarget(): Promise<Target | null> {
  const raw = await SecureStore.getItemAsync(TARGET_KEY);
  return raw ? (JSON.parse(raw) as Target) : null;
}

/** Envia uma posição. Devolve false quando a API diz que o pedido não está mais a caminho. */
async function send(target: Target, position: Coordinates): Promise<boolean> {
  const token = await tokenStorage.get();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/company/service-requests/${target.serviceRequestId}/location`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, [COMPANY_HEADER]: target.companyId },
      body: JSON.stringify(position),
    });
    return res.status !== 409 && res.status !== 404 && res.status !== 401;
  } catch {
    return true; // sem rede: tenta de novo no próximo ponto
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations.length) return;
  const target = await readTarget();
  if (!target) return stopTracking();
  const { latitude, longitude } = data.locations[data.locations.length - 1].coords;
  if (!(await send(target, { latitude, longitude }))) await stopTracking();
});

export async function isTracking(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TASK);
}

/** Começa a enviar a posição do pedido a caminho. Pede as permissões; sem elas, não envia. */
export async function startTracking(target: Target): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') return false;
  await SecureStore.setItemAsync(TARGET_KEY, JSON.stringify(target));
  if (!(await isTracking())) {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: GPS_INTERVAL_MS,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Despacho: a caminho do cliente',
        notificationBody: 'Sua posição está sendo compartilhada com o cliente.',
      },
    });
  }
  return true;
}

export async function stopTracking(): Promise<void> {
  await SecureStore.deleteItemAsync(TARGET_KEY);
  if (await isTracking()) await Location.stopLocationUpdatesAsync(TASK);
}

/** O pedido que está sendo rastreado agora, se houver. */
export async function trackedTarget(): Promise<Target | null> {
  return (await isTracking()) ? readTarget() : null;
}
