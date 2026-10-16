import { joinCompanyRequestSchema, type JoinCompanyResponse } from '@despacho/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Button, colors, ErrorText, Field, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { queryKeys } from '@/lib/queries';

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const setPendingJoinCode = useSession((s) => s.setPendingJoinCode);
  const queryClient = useQueryClient();
  const [code, setCode] = useState(params.code ?? '');
  const [error, setError] = useState<string | null>(null);

  // O código pendente (de um link aberto antes do login) já foi usado para chegar aqui.
  useEffect(() => setPendingJoinCode(null), [setPendingJoinCode]);

  const join = useMutation({
    mutationFn: (body: { code: string }) => api<JoinCompanyResponse>('/join', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      router.back();
    },
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    const input = joinCompanyRequestSchema.safeParse({ code });
    if (!input.success) return setError(input.error.issues[0].message);
    setError(null);
    join.mutate(input.data);
  };

  return (
    <Screen>
      <Title subtitle="Digite o código que a empresa passou para você.">Código de acesso</Title>
      <Field
        label="Código"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Ex.: K7M2QX9P"
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <Button onPress={submit} loading={join.isPending}>Entrar</Button>
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        Se a empresa enviou um link, basta abri-lo no celular.
      </Text>
    </Screen>
  );
}
