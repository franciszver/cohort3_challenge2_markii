import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useTheme } from '../utils/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetPassword, confirmResetPassword, signIn } from 'aws-amplify/auth';
import OfflineBanner from '../components/OfflineBanner';
import NetInfo from '@react-native-community/netinfo';

export default function ForgotPasswordLinearScreen({ navigation }: any) {
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [emailFocused, setEmailFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    (async () => {
      try { const saved = await AsyncStorage.getItem('auth:email'); if (saved) setEmail(saved); } catch {}
    })();
    const unsub = NetInfo.addEventListener((s)=>{
      try { const offline = s.isConnected === false || s.isInternetReachable === false; setIsOnline(!offline); } catch {}
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const onRequest = async () => {
    setError(null); setBusy(true);
    try { await resetPassword({ username: email.trim() }); setStep(2); } catch (e: any) { setError(e?.message || 'Failed to send code'); }
    finally { setBusy(false); }
  };
  const onConfirm = async () => {
    setError(null); setBusy(true);
    try { await confirmResetPassword({ username: email.trim(), confirmationCode: code.trim(), newPassword: password });
      try { await signIn({ username: email.trim(), password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } }); navigation.replace('Conversations', { fromAuth: true }); } catch { navigation.replace('Auth'); }
    } catch (e: any) { setError(e?.message || 'Failed to set new password'); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
      <OfflineBanner />
      <Animated.View style={{ width: '100%', maxWidth: 420, opacity: fadeAnim }}>
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12, color: theme.colors.textPrimary }}>Reset your password</Text>
          {step === 1 ? (
            <>
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
                onSubmitEditing={() => { if (email && !busy && isOnline) onRequest(); }}
                style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: 8, backgroundColor: theme.colors.inputBackground, borderColor: emailFocused ? theme.colors.primary : theme.colors.border, borderRadius: theme.radii.md }}
              />
              <TouchableOpacity
                onPress={onRequest}
                disabled={!email || busy || !isOnline}
                style={{ backgroundColor: theme.colors.buttonPrimaryBg, padding: 12, borderRadius: theme.radii.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!email || busy || !isOnline) ? 0.6 : 1, minHeight: 44, justifyContent: 'center' }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Send password reset code"
              >
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Sending…</Text>
                  </View>
                ) : (
                  <Text style={{ color: theme.colors.buttonPrimaryText, fontWeight: '600' }}>Send Code</Text>
                )}
              </TouchableOpacity>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Verification code</Text>
              <TextInput
                placeholder="Enter code"
                value={code}
                onChangeText={setCode}
                returnKeyType="next"
                onFocus={() => setCodeFocused(true)}
                onBlur={() => setCodeFocused(false)}
                style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: 8, backgroundColor: theme.colors.inputBackground, borderColor: codeFocused ? theme.colors.primary : theme.colors.border, borderRadius: theme.radii.md }}
              />
              <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>New password</Text>
              <View style={{ position: 'relative', marginBottom: 8 }}>
                <TextInput
                  placeholder="Enter new password"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="go"
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  onSubmitEditing={() => { if (code && password && !busy && isOnline) onConfirm(); }}
                  style={{ borderWidth: 1, padding: theme.spacing.sm, paddingRight: 64, backgroundColor: theme.colors.inputBackground, borderColor: passwordFocused ? theme.colors.primary : theme.colors.border, borderRadius: theme.radii.md }}
                />
                <TouchableOpacity onPress={() => setShowPassword(v=>!v)} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: 8, paddingVertical: 4, paddingHorizontal: 8 }}>
                  <Text style={{ fontWeight: '600', color: theme.colors.textPrimary }}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={onConfirm}
                disabled={!code || !password || busy || !isOnline}
                style={{ backgroundColor: theme.colors.buttonPrimaryBg, padding: 12, borderRadius: theme.radii.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!code || !password || busy || !isOnline) ? 0.6 : 1, minHeight: 44, justifyContent: 'center' }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Submit new password"
              >
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Submitting…</Text>
                  </View>
                ) : (
                  <Text style={{ color: theme.colors.buttonPrimaryText, fontWeight: '600' }}>Submit</Text>
                )}
              </TouchableOpacity>
            </>
          ) : null}

          {error ? <Text style={{ color: theme.colors.danger, marginTop: 12, textAlign: 'center' }}>{error}</Text> : null}
        </View>
      </Animated.View>
    </View>
  );
}


