import type { Coordinates } from '@despacho/shared';
import { Text, View } from 'react-native';
import { colors } from './ui';

/** Versão web (só desenvolvimento e testes): mostra as coordenadas no lugar do mapa. */
export function LiveMap({ destination, provider }: { destination: Coordinates; provider: Coordinates | null }) {
  const format = (c: Coordinates) => `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
  return (
    <View style={{ flex: 1, padding: 24, gap: 8 }}>
      <Text style={{ color: colors.muted }}>Mapa indisponível na web.</Text>
      <Text style={{ color: colors.text }}>Seu endereço: {format(destination)}</Text>
      <Text style={{ color: colors.text }}>Prestador: {provider ? format(provider) : 'aguardando a primeira posição'}</Text>
    </View>
  );
}
