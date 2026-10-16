import {
  DEFAULT_SERVICE_RADIUS_KM,
  type Coordinates,
  type ProviderProfile,
  type UpdateProviderSettingsRequest,
} from '@despacho/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { BaseLocationMap } from '@/components/base-location-map';
import { Button, colors, ErrorText } from '@/components/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

const RADIUS_OPTIONS = [5, 10, 20, 30, 50];

export default function ProviderSettingsScreen() {
  const { companyId, companyName } = useLocalSearchParams<{ companyId: string; companyName?: string }>();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: queryKeys.providerProfile(companyId),
    queryFn: () => api<ProviderProfile>('/company/provider-profile', { companyId }),
  });

  if (profile.isPending) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (profile.isError) return <ErrorText>{profile.error.message}</ErrorText>;
  return (
    <>
      <Stack.Screen options={{ title: companyName ?? 'Minha atuação' }} />
      <SettingsForm companyId={companyId} profile={profile.data} onSaved={(data) => queryClient.setQueryData(queryKeys.providerProfile(companyId), data)} />
    </>
  );
}

/** Formulário com estado inicial vindo da atuação salva. */
function SettingsForm({
  companyId,
  profile,
  onSaved,
}: {
  companyId: string;
  profile: ProviderProfile;
  onSaved: (data: ProviderProfile) => void;
}) {
  const [baseLocation, setBaseLocation] = useState<Coordinates | null>(profile.baseLocation);
  const [radiusKm, setRadiusKm] = useState(profile.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);

  const update = useMutation({
    mutationFn: (body: UpdateProviderSettingsRequest) =>
      api<ProviderProfile>('/company/provider-profile', { method: 'PATCH', body, companyId }),
    onSuccess: (data) => {
      onSaved(data);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const useCurrentLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Sem permissão de localização. Marque o ponto no mapa.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setBaseLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setSaved(false);
    } catch {
      setError('Não foi possível obter sua localização. Marque o ponto no mapa.');
    } finally {
      setLocating(false);
    }
  };

  const hasBase = profile.baseLocation !== null;
  const dirty =
    baseLocation !== null &&
    (radiusKm !== profile.serviceRadiusKm ||
      baseLocation.latitude !== profile.baseLocation?.latitude ||
      baseLocation.longitude !== profile.baseLocation?.longitude);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Disponível para novos pedidos</Text>
          <Text style={styles.hint}>
            {hasBase ? 'Desligue quando não puder atender.' : 'Cadastre o endereço-base para poder ligar.'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Disponível para novos pedidos"
          value={profile.available}
          disabled={!hasBase || update.isPending}
          onValueChange={(available) => update.mutate({ available })}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Endereço-base</Text>
        <Text style={styles.hint}>
          {hasBase
            ? 'O ponto de onde você sai para atender. Toque no mapa ou arraste o pino para mudar.'
            : 'Marque no mapa de onde você sai para atender. Sem isso, você não recebe pedidos.'}
        </Text>
        <BaseLocationMap value={baseLocation} radiusKm={radiusKm} onChange={(v) => (setBaseLocation(v), setSaved(false))} />
        <Button variant="link" onPress={useCurrentLocation} loading={locating}>
          Usar minha localização
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Área de atendimento</Text>
        <Text style={styles.hint}>Até quantos km do endereço-base você atende.</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {RADIUS_OPTIONS.map((km) => {
            const selected = km === radiusKm;
            return (
              <Pressable
                key={km}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${km} km`}
                onPress={() => (setRadiusKm(km), setSaved(false))}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{km} km</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ErrorText>{error}</ErrorText>
      {saved && !dirty ? <Text style={styles.saved}>Salvo</Text> : null}
      <Button
        loading={update.isPending}
        onPress={() => {
          if (!baseLocation) return setError('Marque o endereço-base no mapa');
          update.mutate({ baseLocation, serviceRadiusKm: radiusKm }, { onSuccess: () => setSaved(true) });
        }}
      >
        Salvar endereço e área
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { gap: 8 },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.onPrimary, fontWeight: '600' },
  saved: { color: '#059669', fontSize: 14 },
});
