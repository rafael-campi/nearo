import {
  createServiceRequestSchema,
  MAX_REQUEST_PHOTOS,
  type CategoryOption,
  type Coordinates,
  type CreateServiceRequest,
  type ServiceRequest,
} from '@despacho/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LocationPicker } from '@/components/location-picker';
import { PhotoStrip } from '@/components/photo-strip';
import { Button, colors, ErrorText, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { currentLocation } from '@/lib/location';
import { pickPhoto, uploadPhoto, type Photo } from '@/lib/photos';
import { queryKeys } from '@/lib/queries';

export default function NewRequestScreen() {
  const { companyId, companyName } = useLocalSearchParams<{ companyId: string; companyName?: string }>();
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: queryKeys.categoryOptions(companyId),
    queryFn: () => api<CategoryOption[]>('/company/category-options', { companyId }),
  });

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [complement, setComplement] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  // Fotos já enviadas ao storage: se o pedido falhar e a pessoa tentar de novo, não sobem outra vez.
  const uploadedKeys = useRef(new Map<string, string>());
  const [locating, setLocating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // O pino começa na localização atual.
  useEffect(() => {
    let active = true;
    currentLocation().then((found) => {
      if (!active) return;
      setLocating(false);
      if (found) setLocation((current) => current ?? found);
    });
    return () => {
      active = false;
    };
  }, []);

  const create = useMutation({
    mutationFn: (body: CreateServiceRequest) =>
      api<ServiceRequest>('/company/service-requests', { method: 'POST', body, companyId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myRequests });
      router.back();
    },
    onError: (e) => setError(e.message),
  });

  const addPhoto = async (source: 'library' | 'camera') => {
    const photo = await pickPhoto(source);
    if (photo) setPhotos((list) => [...list, photo].slice(0, MAX_REQUEST_PHOTOS));
  };

  const submit = async () => {
    if (!categoryId) return setError('Escolha a categoria');
    if (!location) return setError('Marque no mapa onde é o serviço');
    setError(null);
    let photoKeys: string[];
    try {
      setUploading(true);
      // As fotos já foram redimensionadas ao escolher; vão direto ao storage antes de criar o pedido.
      photoKeys = await Promise.all(
        photos.map(async (photo) => {
          const known = uploadedKeys.current.get(photo.uri);
          if (known) return known;
          const key = await uploadPhoto(photo, 'request_photo', companyId);
          uploadedKeys.current.set(photo.uri, key);
          return key;
        }),
      );
    } catch (e) {
      return setError((e as Error).message);
    } finally {
      setUploading(false);
    }
    const input = createServiceRequestSchema.safeParse({
      categoryId,
      description,
      location,
      addressComplement: complement,
      photoKeys,
    });
    if (!input.success) return setError(input.error.issues[0].message);
    create.mutate(input.data);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: companyName ? `Pedir a ${companyName}` : 'Novo pedido' }} />

      <View style={styles.section}>
        <Text style={styles.label}>Tipo de serviço</Text>
        {categories.isPending ? (
          <ActivityIndicator />
        ) : categories.isError ? (
          <ErrorText>{categories.error.message}</ErrorText>
        ) : categories.data.length === 0 ? (
          <Text style={styles.hint}>Esta empresa ainda não cadastrou categorias de serviço.</Text>
        ) : (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {categories.data.map((category) => {
              const selected = category.id === categoryId;
              return (
                <Pressable
                  key={category.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={category.name}
                  onPress={() => setCategoryId(category.id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <Field
        label="O que está acontecendo?"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        placeholder="Ex.: a tomada da cozinha está soltando faísca"
        style={styles.multiline}
      />

      <View style={styles.section}>
        <Text style={styles.label}>Onde é o serviço?</Text>
        <Text style={styles.hint}>
          {locating ? 'Buscando sua localização…' : 'Toque no mapa ou arraste o pino até o local exato.'}
        </Text>
        <LocationPicker value={location} onChange={setLocation} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Fotos (opcional)</Text>
        <Text style={styles.hint}>Até {MAX_REQUEST_PHOTOS} fotos ajudam o prestador a entender o problema.</Text>
        <PhotoStrip uris={photos.map((p) => p.uri)} onRemove={(index) => setPhotos((list) => list.filter((_, i) => i !== index))} />
        {photos.length < MAX_REQUEST_PHOTOS ? (
          <View style={styles.chips}>
            <Pressable accessibilityRole="button" onPress={() => addPhoto('library')} style={styles.chip}>
              <Text style={styles.chipText}>Escolher da galeria</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => addPhoto('camera')} style={styles.chip}>
              <Text style={styles.chipText}>Tirar foto</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Field
        label="Complemento (opcional)"
        value={complement}
        onChangeText={setComplement}
        placeholder="Ex.: apto 32, portão azul"
      />

      <Text style={styles.hint}>O endereço completo só é mostrado ao prestador depois que você o confirmar.</Text>
      <ErrorText>{error}</ErrorText>
      <Button onPress={submit} loading={create.isPending || uploading}>
        Pedir serviço
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 20 },
  section: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextSelected: { color: colors.onPrimary, fontWeight: '600' },
});
