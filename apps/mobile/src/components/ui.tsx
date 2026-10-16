import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export const colors = {
  text: '#18181b',
  muted: '#71717a',
  border: '#d4d4d8',
  background: '#fafafa',
  surface: '#ffffff',
  primary: '#18181b',
  onPrimary: '#ffffff',
  danger: '#dc2626',
};

export function Screen({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>{children}</View>
    </KeyboardAvoidingView>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title} accessibilityRole="header">
        {children}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Field({ label, style, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label} nativeID={`label-${label}`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={`label-${label}`}
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

export function Button({
  children,
  onPress,
  loading,
  variant = 'primary',
}: {
  children: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'link';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [primary ? styles.button : styles.link, (pressed || loading) && { opacity: 0.6 }]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.text} />
      ) : (
        <Text style={primary ? styles.buttonText : styles.linkText}>{children}</Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: 24, gap: 16 },
  titleBlock: { gap: 4, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  link: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: colors.text, fontSize: 15, textDecorationLine: 'underline' },
  error: { color: colors.danger, fontSize: 14 },
});
