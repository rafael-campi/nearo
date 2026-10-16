import type { ConfigContext, ExpoConfig } from 'expo/config';

// Estende o app.json com o que depende de ambiente. A chave do Google Maps só é exigida em builds
// Android instalados (o Expo Go já traz a sua); no iOS o mapa é o Apple Maps (ADR 0010).
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    // FCM no build instalado: arquivo do projeto Firebase (não vai para o repositório).
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'O Despacho usa sua localização para marcar o ponto de onde você sai para atender.',
        // Prestador a caminho: a posição segue sendo enviada com o app em segundo plano (serviço em primeiro plano no Android).
        locationAlwaysAndWhenInUsePermission:
          'O Despacho usa sua localização em segundo plano para o cliente acompanhar você a caminho do atendimento.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    'expo-notifications',
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
  ],
});
