import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useTheme } from '../utils/theme';
import { resetPassword } from 'aws-amplify/auth';

export default function ForgotPasswordRequestScreen({ navigation }: any) {
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  const append = (msg: string, payload?: any) => {
    const line = payload ? `${msg} ${JSON.stringify(payload)}` : msg;
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  };

  const onSubmit = async () => {
    setError(null);
    const username = email.trim();
    append('resetPassword start', { username });
    try {
      setIsSending(true);
      const res = await resetPassword({ username });
      append('resetPassword sent', res);
      navigation.navigate('ForgotPasswordCode', { email: username });
    } catch (e: any) {
      append('resetPassword error', { name: e?.name, message: e?.message, code: e?.code });
      setError(e?.message ?? 'Failed to send reset code');
    } finally { setIsSending(false); }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ width: '100%', maxWidth: 420, opacity: fadeAnim }}>
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Email</Text>
          <TextInput
            placeholder="Enter email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="go"
            value={email}
            onChangeText={setEmail}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            onSubmitEditing={() => { if (email && !isSending) onSubmit(); }}
            style={{ borderWidth: 1, padding: 10, marginBottom: 8, backgroundColor: 'white', borderColor: emailFocused ? theme.colors.primary : theme.colors.border, borderRadius: 8 }}
          />

          <TouchableOpacity
            onPress={onSubmit}
            disabled={!email || isSending}
            style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!email || isSending) ? 0.6 : 1 }}
            accessibilityLabel="Send password reset code"
          >
            {isSending ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Sending…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Send Code</Text>
            )}
          </TouchableOpacity>

          {error ? <Text style={{ color: 'red', marginTop: 12, textAlign: 'center' }}>{error}</Text> : null}
          {log ? (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontWeight: '600' }}>Logs:</Text>
              <Text>{log}</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}


