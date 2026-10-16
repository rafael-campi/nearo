import type { Notification } from '@despacho/shared';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, ErrorText } from '@/components/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

const when = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const notifications = useQuery({ queryKey: queryKeys.notifications, queryFn: () => api<Notification[]>('/my/notifications') });
  const markRead = useMutation({
    mutationFn: () => api('/my/notifications/read', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
  const unread = notifications.data?.some((n) => n.readAt === null) ?? false;

  // Abrir a lista marca tudo como lido (o destaque fica até a próxima visita).
  useEffect(() => {
    if (unread && !markRead.isPending) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  if (notifications.isPending) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (notifications.isError) return <ErrorText>{notifications.error.message}</ErrorText>;

  return (
    <View style={styles.container}>
      <FlashList
        data={notifications.data}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma atualização ainda.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.item, item.readAt === null && styles.unread]}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>
              {item.companyName} · {when.format(new Date(item.createdAt))}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { fontSize: 15, color: colors.muted, padding: 24 },
  item: { paddingHorizontal: 24, paddingVertical: 14, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border },
  unread: { backgroundColor: '#fffbeb' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
