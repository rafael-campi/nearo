import type { ConfigContext, ExpoConfig } from 'expo/config';

// Estende o app.json com o que depende de ambiente. A chave do Google Maps só é exigida em builds
// Android instalados (o Expo Go já traz a sua); no iOS o mapa é o Apple Maps (ADR 0010).
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'O Despacho usa sua localização para marcar o ponto de onde você sai para atender.',
      },
    ],
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }],
  ],
});
