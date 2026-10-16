import { resetPasswordRequestSchema } from '@despacho/shared';
import { useMutation } from '@tanstack/react-query';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, colors, ErrorText, Field, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';

/** Link `despacho://reset-password/<token>` do e-mail: define a senha nova. */
export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: (body: { token: string; password: string }) => api('/auth/reset-password', { method: 'POST', body }),
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    const input = resetPasswordRequestSchema.safeParse({ token, password });
    if (!input.success) return setError(input.error.issues[0].message);
    if (password !== confirm) return setError('As senhas não conferem');
    setError(null);
    reset.mutate(input.data);
  };

  return (
    <Screen>
      <Title subtitle="Escolha a senha que você vai usar para entrar.">Criar senha nova</Title>
      {reset.isSuccess ? (
        <>
          <Text style={{ color: colors.text, fontSize: 15 }} accessibilityLiveRegion="polite">
            Senha redefinida! Entre com a senha nova.
          </Text>
          <Link href="/login" replace style={{ textAlign: 'center', paddingVertical: 10, textDecorationLine: 'underline' }}>
            Ir para o login
          </Link>
        </>
      ) : (
        <>
          <Field label="Senha nova" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="Pelo menos 8 caracteres" />
          <Field label="Confirme a senha" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={submit} />
          <ErrorText>{error}</ErrorText>
          <Button onPress={submit} loading={reset.isPending}>
            Redefinir senha
          </Button>
        </>
      )}
    </Screen>
  );
}
