import {
  serviceRequestStatusLabel,
  type MeResponse,
  type ProviderProfile,
  type ServiceRequest,
} from '@despacho/shared';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
  const requests = useQuery({
    queryKey: queryKeys.myRequests,
    queryFn: () => api<ServiceRequest[]>('/my/service-requests'),
    enabled: mode === 'client',
  });
  const items: Item[] =
    mode === 'provider'
      ? companies.map((membership) => ({ kind: 'provider-company', membership }))
      : clientItems(requests.data ?? [], companies);

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
          data={items}
          keyExtractor={itemKey}
          getItemType={(item) => item.kind}
          ListHeaderComponent={<Text style={styles.greeting}>Olá, {me.data.user.name}</Text>}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {mode === 'provider'
                ? 'Você não atende nenhuma empresa no momento.'
                : 'Você ainda não está em nenhuma empresa. Peça o código de acesso à empresa que vai atender você.'}
            </Text>
          }
          renderItem={({ item }) => <HomeItem item={item} />}
        />
      )}
      <View style={styles.footer}>
        {mode === 'client' ? <Button onPress={() => router.push('/join')}>Entrar numa empresa</Button> : null}
        <Button variant="link" onPress={() => router.push('/notifications')}>
          Atualizações
        </Button>
        <Button variant="link" onPress={signOut}>
          Sair
        </Button>
      </View>
    </View>
  );
}

type Item =
  | { kind: 'header'; title: string }
  | { kind: 'request'; request: ServiceRequest }
  | { kind: 'client-company'; membership: Membership }
  | { kind: 'provider-company'; membership: Membership };

/** Modo cliente: "Meus pedidos" (se houver) e "Minhas empresas". */
function clientItems(requests: ServiceRequest[], companies: Membership[]): Item[] {
  if (companies.length === 0) return [];
  return [
    ...(requests.length > 0
      ? [{ kind: 'header', title: 'Meus pedidos' } as const, ...requests.map((request) => ({ kind: 'request', request }) as const)]
      : []),
    { kind: 'header', title: 'Minhas empresas' },
    ...companies.map((membership) => ({ kind: 'client-company', membership }) as const),
  ];
}

function itemKey(item: Item): string {
  switch (item.kind) {
    case 'header':
      return `header:${item.title}`;
    case 'request':
      return `request:${item.request.id}`;
    default:
      return `${item.kind}:${item.membership.companyId}`;
  }
}

function HomeItem({ item }: { item: Item }) {
  switch (item.kind) {
    case 'header':
      return (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {item.title}
        </Text>
      );
    case 'request':
      return <RequestRow request={item.request} />;
    case 'client-company':
      return <ClientCompany membership={item.membership} />;
    case 'provider-company':
      return <ProviderCompany membership={item.membership} />;
  }
}

const requestDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function RequestRow({ request }: { request: ServiceRequest }) {
  const status = request.status === 'open' ? 'Procurando prestador' : serviceRequestStatusLabel[request.status];
  return (
    <View style={styles.company} accessibilityLabel={`Pedido de ${request.categoryName}: ${status}`}>
      <Text style={styles.companyName}>
        {request.categoryName} · {request.companyName}
      </Text>
      <Text style={styles.detail} numberOfLines={2}>
        {request.description}
      </Text>
      <Text style={[styles.detail, request.status === 'open' && styles.searching]}>
        {status} · {requestDate.format(new Date(request.createdAt))}
      </Text>
    </View>
  );
}

function ClientCompany({ membership }: { membership: Membership }) {
  return (
    <View style={[styles.company, styles.companyRow]}>
      <Text style={[styles.companyName, { flex: 1 }]}>{membership.companyName}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Pedir serviço a ${membership.companyName}`}
        onPress={() =>
          router.push({
            pathname: '/request/new',
            params: { companyId: membership.companyId, companyName: membership.companyName },
          })
        }
        style={({ pressed }) => [styles.smallButton, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.smallButtonText}>Pedir serviço</Text>
      </Pressable>
    </View>
  );
}

function ProviderCompany({ membership }: { membership: Membership }) {
  const promptedBaseLocation = useMode((s) => s.promptedBaseLocation);
  const markPromptedBaseLocation = useMode((s) => s.markPromptedBaseLocation);
  const profile = useQuery({
    queryKey: queryKeys.providerProfile(membership.companyId),
    queryFn: () => api<ProviderProfile>('/company/provider-profile', { companyId: membership.companyId }),
  });
  const settings = {
    pathname: '/provider/[companyId]' as const,
    params: { companyId: membership.companyId, companyName: membership.companyName },
  };
  const missingBase = profile.data?.baseLocation === null;

  // Primeiro acesso sem endereço-base: abre o cadastro uma vez por sessão.
  useEffect(() => {
    if (missingBase && !promptedBaseLocation) {
      markPromptedBaseLocation();
      router.push(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingBase, promptedBaseLocation]);

  const names = profile.data?.categories.map((c) => c.name) ?? [];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Atuação em ${membership.companyName}`}
      onPress={() => router.push(settings)}
      style={({ pressed }) => [styles.company, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.companyName}>{membership.companyName}</Text>
      <Text style={styles.detail}>
        {profile.isPending
          ? 'Carregando…'
          : names.length > 0
            ? names.join(' · ')
            : 'Nenhuma categoria atribuída ainda. Fale com a empresa.'}
      </Text>
      {profile.data ? (
        missingBase ? (
          <Text style={styles.warning}>Cadastre seu endereço-base para receber pedidos</Text>
        ) : (
          <Text style={[styles.detail, profile.data.available && styles.available]}>
            {profile.data.available ? 'Disponível' : 'Indisponível'} · até {profile.data.serviceRadiusKm} km
          </Text>
        )
      ) : null}
      {profile.data && !missingBase ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ver pedidos abertos de ${membership.companyName}`}
          onPress={() =>
            router.push({
              pathname: '/open-requests/[companyId]',
              params: { companyId: membership.companyId, companyName: membership.companyName },
            })
          }
          style={({ pressed }) => [styles.smallButton, { alignSelf: 'flex-start', marginTop: 8 }, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.smallButtonText}>Pedidos abertos</Text>
        </Pressable>
      ) : null}
    </Pressable>
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
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  searching: { color: '#b45309', fontWeight: '600' },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  smallButton: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  available: { color: '#059669', fontWeight: '600' },
  warning: { fontSize: 14, color: '#b45309', fontWeight: '600' },
  footer: { padding: 24, gap: 4 },
});
