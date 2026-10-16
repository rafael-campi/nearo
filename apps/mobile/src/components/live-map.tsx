import type { Coordinates } from '@despacho/shared';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { colors } from './ui';

/** Mapa ao vivo: o endereço do pedido e o prestador se movendo até ele. */
export function LiveMap({ destination, provider }: { destination: Coordinates; provider: Coordinates | null }) {
  const map = useRef<MapView>(null);

  // Enquadra os dois pontos a cada posição nova.
  useEffect(() => {
    if (provider) map.current?.fitToCoordinates([destination, provider], { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true });
  }, [destination, provider]);

  return (
    <MapView
      ref={map}
      style={styles.map}
      initialRegion={{ ...destination, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
      accessibilityLabel="Mapa do prestador a caminho"
    >
      <Marker coordinate={destination} title="Seu endereço" />
      {provider ? <Marker coordinate={provider} title="Prestador" pinColor={colors.primary} /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
