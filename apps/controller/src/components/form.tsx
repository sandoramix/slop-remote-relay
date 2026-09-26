import type { ReactNode } from 'react';
import { Pressable, Switch, Text, TextInput, type TextInputProps, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { palette } from '../lib/palette';

/** A titled group of rows, iOS-settings style: quiet label, one card. */
export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      {title ? (
        <Text className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</Text>
      ) : null}
      <View className="overflow-hidden rounded-2xl border border-border bg-card">{children}</View>
      {footer ? <Text className="px-1 text-xs leading-5 text-muted-foreground">{footer}</Text> : null}
    </View>
  );
}

export function Divider() {
  return <View className="ml-4 h-px bg-border" />;
}

/** A tappable row that navigates somewhere. */
export function LinkRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon?: ReactNode;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 px-4 py-3.5 active:bg-accent" accessibilityRole="button">
      {icon}
      <Text className="flex-1 text-base text-foreground">{label}</Text>
      {value ? (
        <Text className="max-w-[45%] text-sm text-muted-foreground" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <ChevronRight size={18} color={palette.muted} />
    </Pressable>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center gap-3 px-4 py-3">
      <View className="flex-1 gap-0.5">
        <Text className="text-base text-foreground">{label}</Text>
        {hint ? <Text className="text-xs leading-4 text-muted-foreground">{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.secondary, true: palette.primary }}
        thumbColor={palette.foreground}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Label, input, and an optional hint or error below it. */
export function Field({
  label,
  hint,
  error,
  right,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; right?: ReactNode }) {
  return (
    <View className="gap-1.5 px-4 py-3">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          autoCorrect={false}
          className={`h-11 flex-1 rounded-xl border bg-secondary px-3 text-base text-foreground ${error ? 'border-destructive' : 'border-transparent'}`}
          {...input}
        />
        {right}
      </View>
      {error ? (
        <Text className="text-xs text-destructive">{error}</Text>
      ) : hint ? (
        <Text className="text-xs leading-4 text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}

export function SmallButton({
  label,
  onPress,
  icon,
  disabled,
  tone = 'neutral',
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
}) {
  const bg = tone === 'primary' ? 'bg-primary' : tone === 'danger' ? 'bg-destructive/15' : 'bg-accent';
  const fg = tone === 'primary' ? 'text-primary-foreground' : tone === 'danger' ? 'text-destructive' : 'text-foreground';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`h-11 flex-row items-center justify-center gap-2 rounded-xl px-4 ${bg} ${disabled ? 'opacity-40' : ''} active:opacity-70`}
    >
      {icon}
      <Text className={`text-sm font-semibold ${fg}`}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`h-14 items-center justify-center rounded-2xl bg-primary ${disabled ? 'opacity-40' : ''} active:opacity-80`}
    >
      <Text className="text-base font-bold text-primary-foreground">{label}</Text>
    </Pressable>
  );
}
