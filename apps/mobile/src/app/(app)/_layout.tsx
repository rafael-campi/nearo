import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" />
      <Stack.Screen name="join" options={{ title: 'Entrar numa empresa', presentation: 'modal' }} />
    </Stack>
  );
}
