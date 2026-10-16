import { REVIEW_WINDOW_DAYS, type RequestReviews } from '@despacho/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorText, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

/** Avaliar o outro lado do pedido concluído (às cegas) e ver as avaliações já reveladas. */
export default function ReviewScreen() {
  const { id, companyId } = useLocalSearchParams<{ id: string; companyId: string }>();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reviews = useQuery({
    queryKey: queryKeys.reviews(id),
    queryFn: () => api<RequestReviews>(`/company/service-requests/${id}/reviews`, { companyId }),
  });
  const send = useMutation({
    mutationFn: () => api(`/company/service-requests/${id}/reviews`, { method: 'POST', body: { rating, comment }, companyId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.reviews(id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
    onError: (e) => setError(e.message),
  });

  if (reviews.isPending) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (reviews.isError) return <ErrorText>{reviews.error.message}</ErrorText>;
  const { canReview, deadline } = reviews.data;
  const submit = () => {
    if (rating < 1) return setError('Escolha uma nota de 1 a 5');
    setError(null);
    send.mutate();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Avaliação' }} />
      {canReview ? (
        <View style={styles.section}>
          <Text style={styles.label}>Como foi o atendimento?</Text>
          <View style={styles.stars} accessibilityRole="radiogroup">
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: rating === value }}
                accessibilityLabel={`${value} ${value === 1 ? 'estrela' : 'estrelas'}`}
                onPress={() => setRating(value)}
              >
                <Text style={[styles.star, value <= rating && styles.starOn]}>★</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Comentário (opcional)" value={comment} onChangeText={setComment} multiline numberOfLines={3} maxLength={1000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <Text style={styles.hint}>
            A avaliação é às cegas: só aparece para a outra pessoa quando as duas forem enviadas
            {deadline ? ` ou em ${dateFormat.format(new Date(deadline))}, fim do prazo de ${REVIEW_WINDOW_DAYS} dias` : ''}.
          </Text>
          <ErrorText>{error}</ErrorText>
          <Button onPress={submit} loading={send.isPending}>
            Enviar avaliação
          </Button>
        </View>
      ) : (
        <Text style={styles.hint}>
          {reviews.data.reviews.some((r) => r.mine)
            ? 'Você já avaliou este pedido.'
            : 'O prazo para avaliar este pedido acabou.'}
        </Text>
      )}

      {reviews.data.reviews.map((review) => (
        <View key={review.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {review.mine ? 'Sua avaliação' : `Avaliação de ${review.reviewerName ?? 'Usuário removido'}`} · {'★'.repeat(review.rating)}
          </Text>
          {review.comment ? <Text style={styles.cardBody}>{review.comment}</Text> : null}
          {review.mine && !review.visible ? <Text style={styles.hint}>Ainda não visível para a outra pessoa.</Text> : null}
        </View>
      ))}
      <Button variant="link" onPress={() => router.back()}>
        Voltar
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 16 },
  section: { gap: 12 },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  stars: { flexDirection: 'row', gap: 6 },
  star: { fontSize: 36, color: colors.border },
  starOn: { color: '#f59e0b' },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  card: { padding: 14, gap: 4, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardBody: { fontSize: 14, color: colors.text },
});
