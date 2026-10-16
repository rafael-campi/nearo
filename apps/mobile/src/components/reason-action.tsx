import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, ErrorText } from './ui';

/**
 * Ação que exige um motivo em texto livre (cancelar pedido, desistir): um botão que abre o campo de
 * motivo e só então confirma.
 */
export function ReasonAction({
  label,
  confirmLabel,
  pending,
  error,
  onSubmit,
}: {
  label: string;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  onSubmit: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
        <Text style={styles.linkText}>{label}</Text>
      </Pressable>
    );
  }
  const valid = reason.trim().length >= 3;
  return (
    <View style={styles.box}>
      <TextInput
        accessibilityLabel="Motivo"
        placeholder="Conte o motivo"
        placeholderTextColor={colors.muted}
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        multiline
        style={styles.input}
      />
      <ErrorText>{error}</ErrorText>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={[styles.button, styles.secondary]}>
          <Text style={styles.secondaryText}>Voltar</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          disabled={!valid || pending}
          onPress={() => onSubmit(reason.trim())}
          style={[styles.button, styles.danger, (!valid || pending) && { opacity: 0.5 }]}
        >
          <Text style={styles.dangerText}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', paddingVertical: 8 },
  linkText: { color: '#b91c1c', fontSize: 14, fontWeight: '600' },
  box: { gap: 8, marginTop: 8 },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, alignItems: 'center', borderRadius: 8, paddingVertical: 10 },
  secondary: { borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontWeight: '600' },
  danger: { backgroundColor: '#b91c1c' },
  dangerText: { color: '#fff', fontWeight: '600' },
});
