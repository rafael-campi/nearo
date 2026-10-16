import { Stack } from 'expo-router';
import { usePushRegistration } from '@/lib/push';
import { useRealtime } from '@/lib/realtime';

export default function AppLayout() {
  useRealtime();
  usePushRegistration();
  return (
    <Stack>
      <Stack.Screen name="index" />
      <Stack.Screen name="join" options={{ title: 'Entrar numa empresa', presentation: 'modal' }} />
      <Stack.Screen name="provider/[companyId]" options={{ title: 'Minha atuação' }} />
      <Stack.Screen name="request/new" options={{ title: 'Novo pedido' }} />
      <Stack.Screen name="open-requests/[companyId]" options={{ title: 'Pedidos abertos' }} />
      <Stack.Screen name="account/delete" options={{ title: 'Excluir conta' }} />
      <Stack.Screen name="review/[id]" options={{ title: 'Avaliação' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Conversa' }} />
      <Stack.Screen name="request/[id]" options={{ title: 'Acompanhar' }} />
      <Stack.Screen name="notifications" options={{ title: 'Atualizações' }} />
    </Stack>
  );
}
