import type { MeResponse } from '@despacho/shared';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorText } from '@/components/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { useSession } from '@/lib/session';

export default function HomeScreen() {
  const signOut = useSession((s) => s.signOut);
  const pendingJoinCode = useSession((s) => s.pendingJoinCode);
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api<MeResponse>('/me') });

  // Link de código de acesso aberto antes do login: segue para a entrada na empresa.
  useEffect(() => {
    if (pendingJoinCode) router.push({ pathname: '/join', params: { code: pendingJoinCode } });
  }, [pendingJoinCode]);

  const companies = me.data?.memberships.filter((m) => m.role === 'client') ?? [];

  return (
    <View style={styles.container}>
      {me.isPending ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : me.isError ? (
        <ErrorText>{me.error.message}</ErrorText>
      ) : (
        <FlashList
          data={companies}
          keyExtractor={(item) => item.companyId}
          ListHeaderComponent={<Text style={styles.greeting}>Olá, {me.data.user.name}</Text>}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Você ainda não está em nenhuma empresa. Peça o código de acesso à empresa que vai atender você.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.company}>
              <Text style={styles.companyName}>{item.companyName}</Text>
            </View>
          )}
        />
      )}
      <View style={styles.footer}>
        <Button onPress={() => router.push('/join')}>Entrar numa empresa</Button>
        <Button variant="link" onPress={signOut}>
          Sair
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  greeting: { fontSize: 15, color: colors.muted, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  empty: { fontSize: 15, color: colors.muted, paddingHorizontal: 24, lineHeight: 22 },
  company: {
    marginHorizontal: 24,
    marginBottom: 8,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  companyName: { fontSize: 16, fontWeight: '600', color: colors.text },
  footer: { padding: 24, gap: 4 },
});
