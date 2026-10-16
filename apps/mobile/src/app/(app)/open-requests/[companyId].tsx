import type { OpenServiceRequest } from '@despacho/shared';
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
        ListEmptyComponent={<Text style={styles.empty}>Nenhum pedido aberto para você agora. Avisaremos quando chegar um.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
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

const styles = StyleSheet.create({
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
