import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useTheme } from '../utils/theme';
import { confirmResetPassword, signIn } from 'aws-amplify/auth';

export default function ForgotPasswordNewPasswordScreen({ route, navigation }: any) {
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const { email, code } = route.params || {};
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    try {
      setBusy(true);
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword: password });
      try {
        await signIn({ username: email, password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } });
        navigation.replace('Home');
      } catch {
        navigation.replace('Auth');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to set new password');
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ width: '100%', maxWidth: 420, opacity: fadeAnim }}>
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>New password</Text>
          <TextInput
            placeholder="Enter new password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onFocus={() => setPwFocused(true)}
            onBlur={() => setPwFocused(false)}
            style={{ borderWidth: 1, padding: 10, marginBottom: 8, backgroundColor: 'white', borderColor: pwFocused ? theme.colors.primary : theme.colors.border, borderRadius: 8 }}
          />
          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Confirm new password</Text>
          <TextInput
            placeholder="Re-enter new password"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            onFocus={() => setConfirmFocused(true)}
            onBlur={() => setConfirmFocused(false)}
            onSubmitEditing={() => { if (password && confirm && !busy) onSubmit(); }}
            style={{ borderWidth: 1, padding: 10, marginBottom: 8, backgroundColor: 'white', borderColor: confirmFocused ? theme.colors.primary : theme.colors.border, borderRadius: 8 }}
          />

          {error ? <Text style={{ color: 'red', marginTop: 12, textAlign: 'center' }}>{error}</Text> : null}

          <TouchableOpacity
            onPress={onSubmit}
            disabled={!password || !confirm || busy}
            style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!password || !confirm || busy) ? 0.6 : 1 }}
            accessibilityLabel="Submit new password"
          >
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Submitting…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}


