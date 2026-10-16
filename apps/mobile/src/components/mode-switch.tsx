import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppMode } from '@/lib/mode';
import { colors } from './ui';

const options: { value: AppMode; label: string }[] = [
  { value: 'client', label: 'Cliente' },
  { value: 'provider', label: 'Prestador' },
];

export function ModeSwitch({ mode, onChange }: { mode: AppMode; onChange: (mode: AppMode) => void }) {
  return (
    <View style={styles.container} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === mode;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`Modo ${option.label.toLowerCase()}`}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 16,
    padding: 4,
    borderRadius: 10,
    backgroundColor: '#e4e4e7',
  },
  option: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  selected: { backgroundColor: colors.surface },
  label: { fontSize: 14, fontWeight: '600', color: colors.muted },
  selectedLabel: { color: colors.text },
});
