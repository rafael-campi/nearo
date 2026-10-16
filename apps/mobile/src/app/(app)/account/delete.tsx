import type { DeleteAccountRequest } from '@despacho/shared';
import { useMutation } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Exclusão da própria conta (exigência das lojas e LGPD). Pede a senha para confirmar. */
export default function DeleteAccountScreen() {
  const signOut = useSession((s) => s.signOut);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (body: DeleteAccountRequest) => api('/my/account', { method: 'DELETE', body }),
    onSuccess: () => signOut(),
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    if (!password) return setError('Informe sua senha');
    setError(null);
    remove.mutate({ password });
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Excluir conta' }} />
      <Title subtitle="Isso não pode ser desfeito.">Excluir minha conta</Title>
      <Text style={styles.text}>
        Apagamos seu nome, e-mail, telefone e endereço-base, e você sai de todas as empresas. Seus pedidos, mensagens e
        avaliações continuam no histórico das empresas, como “Usuário removido”.
      </Text>
      <Text style={styles.text}>Não dá para excluir com pedido aberto ou em andamento.</Text>
      <Field label="Sua senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={submit} />
      <ErrorText>{error}</ErrorText>
      <Button onPress={submit} loading={remove.isPending}>
        Excluir minha conta
      </Button>
      <Button variant="link" onPress={() => router.back()}>
        Voltar
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 22 },
});
