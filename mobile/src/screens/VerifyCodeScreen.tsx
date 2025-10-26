import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useTheme } from '../utils/theme';
import { confirmSignUp, signIn, resendSignUpCode } from 'aws-amplify/auth';

export default function VerifyCodeScreen({ route, navigation }: any) {
  const theme = useTheme();
  const initialEmail = (route?.params?.email as string | undefined) || '';
  const initialPassword = (route?.params?.password as string | undefined) || '';
  const [email, setEmail] = useState<string>(initialEmail);
  const [password] = useState<string>(initialPassword);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const append = (msg: string, payload?: any) => {
    const line = payload ? `${msg} ${JSON.stringify(payload)}` : msg;
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  };

  const onConfirm = async () => {
    setError(null);
    append('confirm start', { email });
    try {
      setConfirming(true);
      await confirmSignUp({ username: email, confirmationCode: code });
      append('confirm success');
      // Auto sign in
      try {
        if (password) {
          await signIn({ username: email, password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } });
          navigation.replace('Conversations', { fromAuth: true });
        } else {
          navigation.replace('Auth');
        }
      } catch (se: any) {
        append('auto signIn error', { name: se?.name, message: se?.message });
        navigation.replace('Auth');
      }
    } catch (e: any) {
      append('confirm error', { name: e?.name, message: e?.message });
      setError(e?.message ?? 'Confirmation failed');
    } finally { setConfirming(false); }
  };

  const onResend = async () => {
    if (!email) return;
    setError(null);
    setIsResending(true);
    append('resend start', { email });
    try {
      await resendSignUpCode({ username: email });
      append('resend success');
    } catch (e: any) {
      append('resend error', { name: e?.name, message: e?.message });
      setError(e?.message ?? 'Resend failed');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ width: '100%', maxWidth: 420, opacity: fadeAnim }}>
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Email</Text>
          <TextInput
            placeholder="Enter email"
            value={email}
            editable={false}
            selectTextOnFocus={false}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: 8, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radii.md }}
          />

          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Verification code</Text>
          <TextInput
            placeholder="Enter code"
            value={code}
            onChangeText={setCode}
            returnKeyType="go"
            autoFocus
            onFocus={() => setCodeFocused(true)}
            onBlur={() => setCodeFocused(false)}
            onSubmitEditing={() => { if (email && code && !confirming) onConfirm(); }}
            style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: 8, backgroundColor: theme.colors.inputBackground, borderColor: codeFocused ? theme.colors.primary : theme.colors.border, borderRadius: theme.radii.md }}
          />

          <TouchableOpacity
            onPress={onConfirm}
            disabled={!email || !code || confirming}
            style={{ backgroundColor: theme.colors.buttonPrimaryBg, padding: 12, borderRadius: theme.radii.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!email || !code || confirming) ? 0.6 : 1, minHeight: 44, justifyContent: 'center' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Confirm verification"
          >
            {confirming ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Confirming…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.buttonPrimaryText, fontWeight: '600' }}>Confirm</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 8 }} />

          <TouchableOpacity
            onPress={onResend}
            disabled={!email || isResending}
            style={{ backgroundColor: theme.colors.buttonPrimaryBg, padding: 12, borderRadius: theme.radii.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!email || isResending) ? 0.6 : 1, minHeight: 44, justifyContent: 'center' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Resend verification code"
          >
            {isResending ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Resending…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.buttonPrimaryText, fontWeight: '600' }}>Resend Code</Text>
            )}
          </TouchableOpacity>

          {error ? <Text style={{ color: theme.colors.danger, marginTop: 12, textAlign: 'center' }}>{error}</Text> : null}
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


