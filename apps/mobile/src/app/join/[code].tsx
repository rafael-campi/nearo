import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';

/** Link `despacho://join/<código>`: entra direto, ou guarda o código até o login. */
export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const status = useSession((s) => s.status);
  const setPendingJoinCode = useSession((s) => s.setPendingJoinCode);

  useEffect(() => {
    if (status !== 'signedIn') setPendingJoinCode(code);
  }, [code, status, setPendingJoinCode]);

  if (status === 'signedIn') return <Redirect href={{ pathname: '/join', params: { code } }} />;
  return <Redirect href="/login" />;
}
