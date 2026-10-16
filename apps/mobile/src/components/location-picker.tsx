import type { Coordinates } from '@despacho/shared';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Circle, Marker, type LatLng } from 'react-native-maps';
import { colors } from './ui';

// Centro de São Paulo, quando ainda não há ponto nem localização.
const FALLBACK = { latitude: -23.5505, longitude: -46.6333 };

/**
 * Mapa para marcar um ponto: toque ou arraste o pino. Com `radiusKm`, mostra o círculo da área de atendimento.
 */
export function LocationPicker({
  value,
  radiusKm,
  onChange,
}: {
  value: Coordinates | null;
  radiusKm?: number;
  onChange: (value: Coordinates) => void;
}) {
  const map = useRef<MapView>(null);
  // Zoom que mostra a área de atendimento inteira.
  const delta = radiusKm ? Math.max(0.05, (radiusKm / 111) * 2.4) : 0.01;
  const set = (c: LatLng) => onChange({ latitude: c.latitude, longitude: c.longitude });

  // Região não controlada (deixa a pessoa mover o mapa); só recentraliza quando o pino ou o raio mudam.
  useEffect(() => {
    if (value) map.current?.animateToRegion({ ...value, latitudeDelta: delta, longitudeDelta: delta }, 300);
  }, [value, delta]);

  return (
    <MapView
      ref={map}
      style={styles.map}
      initialRegion={{ ...(value ?? FALLBACK), latitudeDelta: delta, longitudeDelta: delta }}
      onPress={(e) => set(e.nativeEvent.coordinate)}
      accessibilityLabel="Mapa"
    >
      {value ? (
        <>
          <Marker coordinate={value} draggable onDragEnd={(e) => set(e.nativeEvent.coordinate)} />
          {radiusKm ? (
            <Circle
              center={value}
              radius={radiusKm * 1000}
              strokeColor={colors.primary}
              fillColor="rgba(24, 24, 27, 0.08)"
            />
          ) : null}
        </>
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, borderRadius: 12, overflow: 'hidden' },
});
