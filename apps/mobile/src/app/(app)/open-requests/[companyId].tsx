import { nextServiceStep, serviceRequestStatusLabel, type OpenServiceRequest, type ProviderServiceRequest } from '@despacho/shared';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, ErrorText } from '@/components/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

const when = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function OpenRequestsScreen() {
  const { companyId, companyName } = useLocalSearchParams<{ companyId: string; companyName?: string }>();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: queryKeys.openRequests(companyId),
    queryFn: () => api<OpenServiceRequest[]>('/company/open-requests', { companyId }),
  });
  const mine = useQuery({
    queryKey: queryKeys.providerRequests(companyId),
    queryFn: () => api<ProviderServiceRequest[]>('/company/provider-requests', { companyId }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.openRequests(companyId) });
  const accept = useMutation({
    mutationFn: (id: string) => api(`/company/service-requests/${id}/accept`, { method: 'POST', companyId }),
    // Perdeu a corrida ("não está mais disponível"): a lista é atualizada e o erro aparece.
    onSettled: refresh,
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/company/service-requests/${id}/decline`, { method: 'POST', companyId }),
    onSettled: refresh,
  });
  const busy = accept.isPending || decline.isPending;
  const error = accept.error ?? decline.error;

  if (requests.isPending) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (requests.isError) return <ErrorText>{requests.error.message}</ErrorText>;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: companyName ? `Pedidos · ${companyName}` : 'Pedidos abertos' }} />
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      <FlashList
        data={requests.data}
        keyExtractor={(item) => item.id}
        extraData={busy}
        ListHeaderComponent={<MyRequests companyId={companyId} requests={mine.data ?? []} />}
        ListEmptyComponent={<Text style={styles.empty}>Nenhum pedido aberto para você agora. Avisaremos quando chegar um.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {item.assigned ? <Text style={styles.status}>Atribuído a você pela empresa</Text> : null}
            <Text style={styles.title}>{item.categoryName}</Text>
            <Text style={styles.body}>{item.description}</Text>
            <Text style={styles.meta}>
              {item.neighborhood ?? 'Bairro não identificado'} · a ~{item.distanceKm.toLocaleString('pt-BR')} km · {item.clientFirstName}
            </Text>
            <Text style={styles.meta}>{when.format(new Date(item.createdAt))}</Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Recusar pedido de ${item.categoryName}`}
                disabled={busy}
                onPress={() => decline.mutate(item.id)}
                style={({ pressed }) => [styles.button, styles.secondary, (pressed || busy) && { opacity: 0.6 }]}
              >
                <Text style={styles.secondaryText}>Recusar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Aceitar pedido de ${item.categoryName}`}
                disabled={busy}
                onPress={() => accept.mutate(item.id)}
                style={({ pressed }) => [styles.button, styles.primary, (pressed || busy) && { opacity: 0.6 }]}
              >
                <Text style={styles.primaryText}>Aceitar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

/** Pedidos que o prestador aceitou: endereço completo e telefone só depois da confirmação do cliente. */
function MyRequests({ companyId, requests }: { companyId: string; requests: ProviderServiceRequest[] }) {
  const queryClient = useQueryClient();
  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/company/service-requests/${id}/status`, { method: 'POST', body: { status }, companyId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.providerRequests(companyId) }),
  });
  if (requests.length === 0) return null;
  return (
    <View>
      <Text style={styles.section} accessibilityRole="header">
        Seus pedidos
      </Text>
      {advance.error ? <ErrorText>{advance.error.message}</ErrorText> : null}
      {requests.map((r) => (
        <View key={r.id} style={styles.card} accessibilityLabel={`Pedido de ${r.categoryName}: ${serviceRequestStatusLabel[r.status]}`}>
          <Text style={styles.title}>{r.categoryName}</Text>
          <Text style={styles.body}>{r.description}</Text>
          {r.details ? (
            <>
              <Text style={styles.meta}>
                {r.details.clientName}
                {r.details.clientPhone ? ` · ${r.details.clientPhone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')}` : ''}
              </Text>
              <Text style={styles.meta}>
                {[r.neighborhood, r.details.addressComplement].filter(Boolean).join(' · ')} ({r.details.location.latitude.toFixed(5)},{' '}
                {r.details.location.longitude.toFixed(5)})
              </Text>
            </>
          ) : (
            <Text style={styles.meta}>{r.neighborhood ?? 'Bairro não identificado'} · {r.clientFirstName}</Text>
          )}
          <Text style={styles.status}>
            {r.status === 'awaiting_client' ? 'Aguardando o cliente confirmar' : serviceRequestStatusLabel[r.status]}
          </Text>
          {nextServiceStep[r.status] ? (
            <Pressable
              accessibilityRole="button"
              disabled={advance.isPending}
              onPress={() => advance.mutate({ id: r.id, status: nextServiceStep[r.status]!.to })}
              style={({ pressed }) => [styles.button, styles.primary, { marginTop: 8 }, (pressed || advance.isPending) && { opacity: 0.6 }]}
            >
              <Text style={styles.primaryText}>{nextServiceStep[r.status]!.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Text style={styles.section} accessibilityRole="header">
        Pedidos abertos
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 24, paddingTop: 16 },
  status: { fontSize: 13, fontWeight: '600', color: '#b45309', marginTop: 4 },
  container: { flex: 1, backgroundColor: colors.background },
  empty: { fontSize: 15, color: colors.muted, padding: 24, lineHeight: 22 },
  card: {
    marginHorizontal: 24,
    marginTop: 8,
    padding: 16,
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  button: { flex: 1, alignItems: 'center', borderRadius: 8, paddingVertical: 10 },
  primary: { backgroundColor: colors.primary },
  primaryText: { color: colors.onPrimary, fontWeight: '600' },
  secondary: { borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontWeight: '600' },
});
