import type { ProviderLocation, ServiceRequest } from '@despacho/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { LiveMap } from '@/components/live-map';
import { colors } from '@/components/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

/** Acompanhar o prestador a caminho. A posição chega pelo socket (useRealtime grava no cache). */
export default function TrackRequestScreen() {
  const { id, companyId } = useLocalSearchParams<{ id: string; companyId: string }>();
  const requests = useQuery({ queryKey: queryKeys.myRequests, queryFn: () => api<ServiceRequest[]>('/my/service-requests') });
  const request = requests.data?.find((r) => r.id === id);
  const enRoute = request?.status === 'en_route';
  const location = useQuery({
    queryKey: queryKeys.providerLocation(id),
    queryFn: () => api<ProviderLocation | null>(`/company/service-requests/${id}/location`, { companyId }),
    enabled: enRoute,
    // As posições seguintes chegam pelo socket.
    staleTime: Infinity,
  });

  if (!request) return null;
  const provider = enRoute ? (location.data ?? null) : null;
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: request.provider?.name ?? 'Prestador' }} />
      <View style={styles.header}>
        <Text style={styles.title}>
          {enRoute ? `${request.provider?.name.split(' ')[0] ?? 'O prestador'} está a caminho` : 'O prestador não está a caminho'}
        </Text>
        <Text style={styles.detail}>{request.categoryName}</Text>
      </View>
      {enRoute ? <LiveMap destination={request.location} provider={provider ? { latitude: provider.latitude, longitude: provider.longitude } : null} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, gap: 2 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  detail: { fontSize: 14, color: colors.muted },
});
