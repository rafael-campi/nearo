import type { Coordinates } from '@despacho/shared';
import * as Location from 'expo-location';

/** Localização atual, pedindo permissão. null se negada ou indisponível. */
export async function currentLocation(): Promise<Coordinates | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}
