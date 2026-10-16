import { chatWritableStatuses, type Message, type MessagePage } from '@despacho/shared';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, ErrorText } from '@/components/ui';
import { pickPhoto, uploadPhoto, type Photo } from '@/lib/photos';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

interface Pending {
  clientMessageId: string;
  body: string;
  /** Foto escolhida, ainda não enviada ao storage. */
  photo?: Photo;
  /** Chave da foto depois do envio ao storage (reenvio não repete o upload). */
  photoKey?: string;
  failed: boolean;
}

type Row = { kind: 'message'; message: Message } | { kind: 'pending'; pending: Pending };

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Conversa do pedido. `as` diz de que lado a pessoa está; `status` o estado do pedido ao abrir. */
export default function ChatScreen() {
  const { id, companyId, as, status } = useLocalSearchParams<{ id: string; companyId: string; as: 'client' | 'provider'; status: string }>();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [closed, setClosed] = useState(!(chatWritableStatuses as readonly string[]).includes(status));

  const messages = useInfiniteQuery({
    queryKey: queryKeys.chat(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<MessagePage>(`/company/service-requests/${id}/messages${pageParam ? `?cursor=${pageParam}` : ''}`, { companyId }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const send = useMutation({
    mutationFn: async (item: Pending) => {
      // A foto sobe direto ao storage antes da mensagem; a chave fica guardada para o reenvio.
      if (item.photo && !item.photoKey) {
        item.photoKey = await uploadPhoto(item.photo, 'chat_photo', companyId);
      }
      return api<Message>(`/company/service-requests/${id}/messages`, {
        method: 'POST',
        body: { clientMessageId: item.clientMessageId, body: item.body, photoKey: item.photoKey },
        companyId,
      });
    },
    onSuccess: async (_, item) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chat(id) });
      setPending((list) => list.filter((p) => p.clientMessageId !== item.clientMessageId));
    },
    onError: (error, item) => {
      // Conversa encerrada: some a mensagem e fecha o campo. Outro erro: fica na tela para tentar de novo.
      if ('status' in error && error.status === 409) {
        setClosed(true);
        setPending((list) => list.filter((p) => p.clientMessageId !== item.clientMessageId));
      } else {
        setPending((list) => list.map((p) => (p.clientMessageId === item.clientMessageId ? { ...p, failed: true } : p)));
      }
    },
  });

  const [attached, setAttached] = useState<Photo | null>(null);
  const attach = async () => setAttached((await pickPhoto('library')) ?? attached);

  const submit = () => {
    const body = text.trim();
    if (!body && !attached) return;
    // O id nasce aqui: reenviar a mesma mensagem não a duplica no servidor.
    const item: Pending = { clientMessageId: randomUUID(), body, photo: attached ?? undefined, failed: false };
    setText('');
    setAttached(null);
    setPending((list) => [...list, item]);
    send.mutate(item);
  };
  const retry = (item: Pending) => {
    setPending((list) => list.map((p) => (p.clientMessageId === item.clientMessageId ? { ...p, failed: false } : p)));
    send.mutate(item);
  };

  // Páginas vêm da mais recente para a mais antiga; a lista é cronológica.
  const sent = (messages.data?.pages ?? []).slice().reverse().flatMap((page) => page.messages);
  const known = new Set(sent.map((m) => m.clientMessageId));
  const rows: Row[] = [
    ...sent.map((message) => ({ kind: 'message', message }) as const),
    ...pending.filter((p) => !known.has(p.clientMessageId)).map((p) => ({ kind: 'pending', pending: p }) as const),
  ];

  if (messages.isPending) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (messages.isError) return <ErrorText>{messages.error.message}</ErrorText>;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: 'Conversa' }} />
      <FlashList
        data={rows}
        keyExtractor={(row) => (row.kind === 'message' ? row.message.id : row.pending.clientMessageId)}
        getItemType={(row) => row.kind}
        maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
        onStartReached={() => {
          if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
        }}
        ListHeaderComponent={messages.isFetchingNextPage ? <ActivityIndicator style={{ margin: 8 }} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>{closed ? 'Nenhuma mensagem.' : 'Comece a conversa.'}</Text>}
        renderItem={({ item: row }) => {
          const mine = row.kind === 'pending' || row.message.senderRole === as;
          return (
            <View style={[styles.bubbleRow, mine ? styles.mineRow : styles.theirsRow]}>
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && row.kind === 'message' ? <Text style={styles.sender}>{row.message.senderName}</Text> : null}
                {(row.kind === 'message' ? row.message.photoUrl : row.pending.photo?.uri) ? (
                  <Image
                    source={{ uri: (row.kind === 'message' ? row.message.photoUrl : row.pending.photo?.uri) ?? undefined }}
                    style={styles.photo}
                    contentFit="cover"
                    accessibilityLabel="Foto da mensagem"
                  />
                ) : null}
                {(row.kind === 'message' ? row.message.body : row.pending.body) ? (
                  <Text style={mine ? styles.mineText : styles.text}>{row.kind === 'message' ? row.message.body : row.pending.body}</Text>
                ) : null}
                {row.kind === 'message' ? (
                  <Text style={[styles.time, mine && styles.mineTime]}>{time.format(new Date(row.message.createdAt))}</Text>
                ) : row.pending.failed ? (
                  <Pressable accessibilityRole="button" onPress={() => retry(row.pending)}>
                    <Text style={styles.failed}>Não enviada. Tentar de novo</Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.time, styles.mineTime]}>Enviando…</Text>
                )}
              </View>
            </View>
          );
        }}
      />
      {closed ? (
        <Text style={styles.closed}>A conversa está encerrada. Só leitura.</Text>
      ) : (
        <View style={styles.composer}>
          <Pressable accessibilityRole="button" accessibilityLabel="Anexar foto" onPress={attach} style={styles.attach}>
            <Text style={styles.attachText}>{attached ? '✓' : '+'}</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Mensagem"
            value={text}
            onChangeText={setText}
            placeholder="Escreva uma mensagem"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={2000}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar mensagem"
            disabled={!text.trim() && !attached}
            onPress={submit}
            style={({ pressed }) => [styles.sendButton, ((!text.trim() && !attached) || pressed) && { opacity: 0.5 }]}
          >
            <Text style={styles.sendText}>Enviar</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { padding: 24, color: colors.muted, fontSize: 15 },
  bubbleRow: { paddingHorizontal: 12, paddingVertical: 3 },
  mineRow: { alignItems: 'flex-end' },
  theirsRow: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sender: { fontSize: 12, fontWeight: '700', color: colors.muted },
  text: { fontSize: 15, color: colors.text },
  mineText: { fontSize: 15, color: colors.onPrimary },
  time: { fontSize: 11, color: colors.muted, alignSelf: 'flex-end' },
  mineTime: { color: colors.onPrimary, opacity: 0.8 },
  failed: { fontSize: 12, color: '#fecaca', fontWeight: '600' },
  closed: { padding: 16, textAlign: 'center', color: colors.muted, fontSize: 14, borderTopWidth: 1, borderTopColor: colors.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  photo: { width: 200, height: 200, borderRadius: 10 },
  attach: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  attachText: { fontSize: 20, color: colors.text },
  sendButton: { backgroundColor: colors.primary, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: colors.onPrimary, fontWeight: '600' },
});
