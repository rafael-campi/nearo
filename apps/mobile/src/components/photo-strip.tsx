import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from './ui';

/** Fotos em miniatura (expo-image), com "x" para remover quando `onRemove` é passado. */
export function PhotoStrip({ uris, onRemove }: { uris: string[]; onRemove?: (index: number) => void }) {
  if (uris.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {uris.map((uri, index) => (
        <View key={`${uri}-${index}`} style={styles.item}>
          <Image source={{ uri }} style={styles.image} contentFit="cover" accessibilityLabel={`Foto ${index + 1}`} />
          {onRemove ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remover foto ${index + 1}`} onPress={() => onRemove(index)} style={styles.remove}>
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  item: { width: 84, height: 84, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.border },
  image: { width: '100%', height: '100%' },
  remove: { position: 'absolute', top: 2, right: 2, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 16, lineHeight: 18 },
});
