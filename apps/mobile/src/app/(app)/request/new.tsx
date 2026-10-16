import {
  createServiceRequestSchema,
  type CategoryOption,
  type Coordinates,
  type CreateServiceRequest,
  type ServiceRequest,
} from '@despacho/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LocationPicker } from '@/components/location-picker';
import { Button, colors, ErrorText, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { currentLocation } from '@/lib/location';
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

  const submit = () => {
    if (!categoryId) return setError('Escolha a categoria');
    if (!location) return setError('Marque no mapa onde é o serviço');
    const input = createServiceRequestSchema.safeParse({
      categoryId,
      description,
      location,
      addressComplement: complement,
    });
    if (!input.success) return setError(input.error.issues[0].message);
    setError(null);
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

      <Field
        label="Complemento (opcional)"
        value={complement}
        onChangeText={setComplement}
        placeholder="Ex.: apto 32, portão azul"
      />

      <Text style={styles.hint}>O endereço completo só é mostrado ao prestador depois que você o confirmar.</Text>
      <ErrorText>{error}</ErrorText>
      <Button onPress={submit} loading={create.isPending}>
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
