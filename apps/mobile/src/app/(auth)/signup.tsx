import { signupRequestSchema, type SessionResponse, type SignupRequest } from '@despacho/shared';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function SignupScreen() {
  const signIn = useSession((s) => s.signIn);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signup = useMutation({
    mutationFn: (body: SignupRequest) => api<SessionResponse>('/auth/signup', { method: 'POST', body }),
    onSuccess: (res) => signIn(res.token),
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    const input = signupRequestSchema.safeParse({ name, email, password });
    if (!input.success) return setError(input.error.issues[0].message);
    setError(null);
    signup.mutate(input.data);
  };

  return (
    <Screen>
      <Title subtitle="Cadastre-se para pedir serviços às empresas que atendem você.">Criar conta</Title>
      <Field label="Nome" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="Pelo menos 8 caracteres" onSubmitEditing={submit} />
      <ErrorText>{error}</ErrorText>
      <Button onPress={submit} loading={signup.isPending}>Criar conta</Button>
      <Link href="/login" replace style={{ textAlign: 'center', paddingVertical: 10, textDecorationLine: 'underline' }}>
        Já tenho conta
      </Link>
    </Screen>
  );
}
