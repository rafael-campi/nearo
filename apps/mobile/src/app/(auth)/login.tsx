import { loginRequestSchema, type SessionResponse } from '@despacho/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<SessionResponse>('/auth/login', { method: 'POST', body }),
    onSuccess: (res) => signIn(res.token),
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    const input = loginRequestSchema.safeParse({ email, password });
    if (!input.success) return setError(input.error.issues[0].message);
    setError(null);
    login.mutate(input.data);
  };

  return (
    <Screen>
      <Title subtitle="Entre para pedir serviços.">Despacho</Title>
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={submit} />
      <ErrorText>{error}</ErrorText>
      <Button onPress={submit} loading={login.isPending}>Entrar</Button>
      <Link href="/forgot-password" style={{ textAlign: 'center', paddingVertical: 6, textDecorationLine: 'underline' }}>
        Esqueci minha senha
      </Link>
      <Link href="/signup" replace style={{ textAlign: 'center', paddingVertical: 10, textDecorationLine: 'underline' }}>
        Criar conta
      </Link>
    </Screen>
  );
}
