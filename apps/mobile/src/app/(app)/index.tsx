import type { MeResponse, ProviderProfile } from '@despacho/shared';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ModeSwitch } from '@/components/mode-switch';
import { Button, colors, ErrorText } from '@/components/ui';
import { api } from '@/lib/api';
import { useMode } from '@/lib/mode';
import { queryKeys } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Membership = MeResponse['memberships'][number];

export default function HomeScreen() {
  const signOut = useSession((s) => s.signOut);
  const pendingJoinCode = useSession((s) => s.pendingJoinCode);
  const chosenMode = useMode((s) => s.mode);
  const setMode = useMode((s) => s.setMode);
  const me = useQuery({ queryKey: queryKeys.me, queryFn: () => api<MeResponse>('/me') });

  // Link de código de acesso aberto antes do login: segue para a entrada na empresa.
  useEffect(() => {
    if (pendingJoinCode) router.push({ pathname: '/join', params: { code: pendingJoinCode } });
  }, [pendingJoinCode]);

  const memberships = me.data?.memberships ?? [];
  const isProvider = memberships.some((m) => m.role === 'provider');
  // Quem é prestador começa no modo prestador; a escolha vale até sair.
  const mode = isProvider ? (chosenMode ?? 'provider') : 'client';
  const companies = memberships.filter((m) => m.role === mode);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: mode === 'provider' ? 'Onde atendo' : 'Minhas empresas' }} />
      {isProvider ? <ModeSwitch mode={mode} onChange={setMode} /> : null}
      {me.isPending ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : me.isError ? (
        <View style={{ padding: 24 }}>
          <ErrorText>{me.error.message}</ErrorText>
        </View>
      ) : (
        <FlashList
          data={companies}
          keyExtractor={(item) => `${item.role}:${item.companyId}`}
          ListHeaderComponent={<Text style={styles.greeting}>Olá, {me.data.user.name}</Text>}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {mode === 'provider'
                ? 'Você não atende nenhuma empresa no momento.'
                : 'Você ainda não está em nenhuma empresa. Peça o código de acesso à empresa que vai atender você.'}
            </Text>
          }
          renderItem={({ item }) =>
            mode === 'provider' ? <ProviderCompany membership={item} /> : <ClientCompany membership={item} />
          }
        />
      )}
      <View style={styles.footer}>
        {mode === 'client' ? <Button onPress={() => router.push('/join')}>Entrar numa empresa</Button> : null}
        <Button variant="link" onPress={signOut}>
          Sair
        </Button>
      </View>
    </View>
  );
}

function ClientCompany({ membership }: { membership: Membership }) {
  return (
    <View style={styles.company}>
      <Text style={styles.companyName}>{membership.companyName}</Text>
    </View>
  );
}

function ProviderCompany({ membership }: { membership: Membership }) {
  const profile = useQuery({
    queryKey: queryKeys.providerProfile(membership.companyId),
    queryFn: () => api<ProviderProfile>('/company/provider-profile', { companyId: membership.companyId }),
  });
  const names = profile.data?.categories.map((c) => c.name) ?? [];
  return (
    <View style={styles.company}>
      <Text style={styles.companyName}>{membership.companyName}</Text>
      <Text style={styles.detail}>
        {profile.isPending
          ? 'Carregando categorias…'
          : names.length > 0
            ? names.join(' · ')
            : 'Nenhuma categoria atribuída ainda. Fale com a empresa.'}
      </Text>
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
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  companyName: { fontSize: 16, fontWeight: '600', color: colors.text },
  detail: { fontSize: 14, color: colors.muted },
  footer: { padding: 24, gap: 4 },
});
