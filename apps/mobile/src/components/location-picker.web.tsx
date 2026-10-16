import type { Coordinates } from '@despacho/shared';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, Field } from './ui';

type Props = { value: Coordinates | null; radiusKm?: number; onChange: (value: Coordinates) => void };

/**
 * Versão web (só desenvolvimento e testes automatizados): react-native-maps não roda no navegador,
 * então o ponto é informado por latitude e longitude, aplicadas ao sair do campo.
 */
export function LocationPicker({ value, onChange }: Props) {
  // Remonta quando o ponto muda por fora (ex.: "Usar minha localização").
  return <CoordinateFields key={value ? `${value.latitude},${value.longitude}` : 'vazio'} value={value} onChange={onChange} />;
}

function CoordinateFields({ value, onChange }: Omit<Props, 'radiusKm'>) {
  const [latitude, setLatitude] = useState(value ? String(value.latitude) : '');
  const [longitude, setLongitude] = useState(value ? String(value.longitude) : '');
  const commit = () => {
    const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
    if (latitude && longitude && Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) onChange(parsed);
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>Mapa indisponível na web: informe as coordenadas.</Text>
      <Field label="Latitude" value={latitude} onChangeText={setLatitude} onBlur={commit} inputMode="decimal" />
      <Field label="Longitude" value={longitude} onChangeText={setLongitude} onBlur={commit} inputMode="decimal" />
    </View>
  );
}
