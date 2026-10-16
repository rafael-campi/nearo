import { forgotPasswordRequestSchema } from '@despacho/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, colors, ErrorText, Field, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const forgot = useMutation({
    mutationFn: (body: { email: string }) => api('/auth/forgot-password', { method: 'POST', body }),
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    const input = forgotPasswordRequestSchema.safeParse({ email });
    if (!input.success) return setError(input.error.issues[0].message);
    setError(null);
    forgot.mutate(input.data);
  };

  return (
    <Screen>
      <Title subtitle="Enviaremos um link para você criar uma senha nova.">Esqueci minha senha</Title>
      {forgot.isSuccess ? (
        // A mesma resposta exista ou não a conta: o app não revela quais e-mails estão cadastrados.
        <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }} accessibilityLiveRegion="polite">
          Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha. Ele vale por 1 hora e abre este aplicativo.
        </Text>
      ) : (
        <>
          <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" onSubmitEditing={submit} />
          <ErrorText>{error}</ErrorText>
          <Button onPress={submit} loading={forgot.isPending}>
            Enviar link
          </Button>
        </>
      )}
      <Link href="/login" replace style={{ textAlign: 'center', paddingVertical: 10, textDecorationLine: 'underline' }}>
        Voltar para o login
      </Link>
    </Screen>
  );
}
