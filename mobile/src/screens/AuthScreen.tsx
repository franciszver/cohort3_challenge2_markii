import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Button, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signUp, confirmSignUp, signIn, fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';
import { getFlags } from '../utils/flags';
import { ensureProfileSeed } from '../graphql/profile';
import { colorForId } from '../components/Avatar';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import OfflineBanner from '../components/OfflineBanner';
import NetInfo from '@react-native-community/netinfo';
import { useFonts, DancingScript_700Bold } from '@expo-google-fonts/dancing-script';
import { useTheme } from '../utils/theme';

export default function AuthScreen({ navigation }: any) {
  const [titleFontsLoaded] = useFonts({ DancingScript_700Bold });
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(1)).current;
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
  const [mode, setMode] = useState<'initial' | 'signin' | 'signup'>('initial');
  const [log, setLog] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
    const [unverified, setUnverified] = useState<string | null>(null);
    const [isOnline, setIsOnline] = useState<boolean>(true);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const safe = (obj: any) => {
    try {
      return JSON.stringify(obj, Object.getOwnPropertyNames(obj));
    } catch {
      return String(obj);
    }
  };

  const appendLog = (message: string, payload?: unknown) => {
    const line = payload !== undefined ? `${message} ${safe(payload)}` : message;
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  };

  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        appendLog('session detected for user', user);
        setIsSignedIn(true);
        navigation.replace('Conversations');
      } catch {
        setIsSignedIn(false);
      }
      try {
        const { ENABLE_AUTH_UX } = getFlags();
        if (ENABLE_AUTH_UX) {
          const saved = await AsyncStorage.getItem('auth:email');
          if (saved) setEmail(saved);
        }
      } catch {}
    })();
  }, [navigation]);

  function validateFields() {
    const { ENABLE_AUTH_UX } = getFlags();
    if (!ENABLE_AUTH_UX) return true;
    let ok = true;
    const em = email.trim();
    const pw = password;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
    setEmailError(emailOk ? null : 'Enter a valid email');
    if (!emailOk) ok = false;
    const pwOk = pw.length >= 8;
    setPasswordError(pwOk ? null : 'At least 8 characters');
    if (!pwOk) ok = false;
    return ok;
  }

  useEffect(() => {
    try {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    } catch {}
  }, [mode]);

  const onSignUp = async () => {
    setError(null);
    appendLog('signUp start', { email });
    if (!validateFields()) return;
    try {
      setSigningUp(true);
      const res = await signUp({ username: email.trim(), password, options: { userAttributes: { email: email.trim() } } });
      appendLog('signUp success', res);
      try { if (getFlags().ENABLE_AUTH_UX) await AsyncStorage.setItem('auth:email', email.trim()); } catch {}
      navigation.navigate('VerifyCode', { email: email.trim(), password });
    } catch (e: any) {
      appendLog('signUp error', { name: e?.name, message: e?.message, code: e?.code });
      setError(e?.message ?? 'Unknown sign up error');
    } finally { setSigningUp(false); }
  };

  const onConfirm = async () => {
    setError(null);
    appendLog('confirmSignUp start', { email });
    try {
      const res = await confirmSignUp({ username: email, confirmationCode: code });
      appendLog('confirmSignUp success', res);
    } catch (e: any) {
      appendLog('confirmSignUp error', { name: e?.name, message: e?.message, code: e?.code });
      setError(e?.message ?? 'Unknown confirmation error');
    }
  };

  const onSignIn = async () => {
    setError(null);
    appendLog('signIn start', { email });
    if (!validateFields()) return;
    try {
      setSigningIn(true);
      const res = await signIn({ username: email.trim(), password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } });
      appendLog('signIn success', res);
      // Extra diagnostics
      try {
        const user = await getCurrentUser();
        appendLog('currentUser', user);
      } catch (ue) {
        appendLog('getCurrentUser error', ue as any);
      }
      try {
        const session = await fetchAuthSession();
        appendLog('fetchAuthSession', { hasTokens: !!session?.tokens, tokens: session?.tokens ? { accessToken: 'present', idToken: 'present' } : null });
      } catch (se) {
        appendLog('fetchAuthSession error', se as any);
      }
      // Seed profile softly (skip names in sign-in)
      try { const { ENABLE_PROFILES } = getFlags(); if (ENABLE_PROFILES) { const me = await getCurrentUser(); const avatar = colorForId(me.userId); await ensureProfileSeed(me.userId, { avatarColor: avatar }); } } catch {}
      try { if (getFlags().ENABLE_AUTH_UX) await AsyncStorage.setItem('auth:email', email.trim()); } catch {}
      navigation.replace('Conversations', { fromAuth: true });
    } catch (e: any) {
      appendLog('signIn error', { name: e?.name, message: e?.message, code: e?.code, raw: e, stack: e?.stack, cause: e?.cause });
      appendLog('env extra', (Constants.expoConfig?.extra || Constants.manifest?.extra || {}));
      const { ENABLE_AUTH_ERROR_MAP, ENABLE_AUTH_VERIFICATION_INLINE } = getFlags();
      const codeName = e?.code || e?.name;
      if (ENABLE_AUTH_ERROR_MAP && (codeName === 'UserNotConfirmedException' || codeName === 'UserNotConfirmed' || codeName === 'UserUnconfirmedException')) {
        if (ENABLE_AUTH_VERIFICATION_INLINE) setUnverified(email.trim());
        setError('Your email is not verified. Please verify to continue.');
      } else if (ENABLE_AUTH_ERROR_MAP && (codeName === 'NotAuthorizedException' || codeName === 'InvalidPasswordException')) {
        setError('Incorrect email or password.');
      } else if (ENABLE_AUTH_ERROR_MAP && (codeName === 'UserNotFoundException')) {
        setError('No account found with that email.');
      } else if (ENABLE_AUTH_ERROR_MAP && (codeName === 'LimitExceededException' || codeName === 'TooManyRequestsException')) {
        setError('Too many attempts. Please try again later.');
      } else {
        setError(e?.message ?? 'Unknown sign in error');
      }
    } finally { setSigningIn(false); }
  };

  const onForgotPassword = () => {
    try {
      const { ENABLE_FORGOT_LINEAR } = getFlags();
      if (ENABLE_FORGOT_LINEAR) navigation.navigate('ForgotPasswordLinear');
      else navigation.navigate('ForgotPasswordRequest');
    } catch { navigation.navigate('ForgotPasswordRequest'); }
  };

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      try {
        const offline = state.isConnected === false || state.isInternetReachable === false;
        setIsOnline(!offline);
      } catch {}
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const Body = (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
      <OfflineBanner onRetry={() => { /* no-op for auth */ }} />
      {mode !== 'initial' ? (
        <View style={{ marginBottom: 8 }}>
          <TouchableOpacity accessibilityLabel="Back to start" onPress={() => { setMode('initial'); setPassword(''); setError(null); }}>
            <Text style={{ fontSize: 16, color: '#4B5563' }}>{'← Back'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Animated.View style={{ width: '100%', maxWidth: 420, opacity: fadeAnim }}>
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ fontSize: 30, marginBottom: 4, textAlign: 'center', fontFamily: titleFontsLoaded ? 'DancingScript_700Bold' : undefined }}>NegotiatedAi</Text>
          <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginBottom: 16 }}>Let's keep it smooth.</Text>
          <TextInput
            placeholder="Enter email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType={mode === 'signin' ? 'next' : 'done'}
            value={email}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
            onChangeText={(t)=>{ setEmail(t); try { if (getFlags().ENABLE_AUTH_UX) AsyncStorage.setItem('auth:email', t.trim()); } catch {} }}
            style={{ borderWidth: 1, padding: 10, marginBottom: 8, backgroundColor: 'white', borderColor: emailFocused ? theme.colors.primary : theme.colors.border, borderRadius: 8 }}
          />
      {(() => { const { ENABLE_AUTH_UX } = getFlags(); return ENABLE_AUTH_UX && emailError ? (<Text style={{ color: 'red', marginBottom: 8 }}>{emailError}</Text>) : null; })()}
      {mode !== 'initial' ? (
        <>
          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Password</Text>
          <View style={{ position: 'relative', marginBottom: 8 }}>
            <TextInput
              placeholder={mode === 'signup' ? 'Choose a password' : 'Password'}
              secureTextEntry={!showPassword}
              returnKeyType="go"
              value={password}
              onChangeText={(t)=>{ setPassword(t); }}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              onSubmitEditing={() => { if (mode === 'signin') onSignIn(); else if (mode === 'signup') onSignUp(); }}
              style={{ borderWidth: 1, padding: 10, paddingRight: 64, backgroundColor: 'white', borderColor: passwordFocused ? theme.colors.primary : theme.colors.border, borderRadius: 8 }}
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: 8, paddingVertical: 6, paddingHorizontal: 8 }}>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          {mode === 'signup' ? (
            <Text style={{ color: '#374151', marginBottom: 4 }}>Please choose a password to create your account.</Text>
          ) : null}
          {(() => { const { ENABLE_AUTH_UX } = getFlags(); return ENABLE_AUTH_UX && passwordError ? (<Text style={{ color: 'red', marginBottom: 12 }}>{passwordError}</Text>) : null; })()}
        </>
      ) : null}
      {(() => { const { ENABLE_AUTH_VERIFICATION_INLINE } = getFlags(); return (ENABLE_AUTH_VERIFICATION_INLINE && unverified) ? (
        <View style={{ padding: 8, backgroundColor: '#f0f9ff', borderWidth: 1, borderColor: '#bae6fd', borderRadius: 6, marginBottom: 12 }}>
          <Text style={{ color: '#0369a1', marginBottom: 8 }}>Your email isn’t verified.</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button title="Resend code" onPress={async () => { try { const { resendSignUpCode } = await import('aws-amplify/auth'); await resendSignUpCode({ username: unverified }); } catch {} }} />
            <Button title="Enter code" onPress={() => navigation.navigate('VerifyCode', { email: unverified, password })} color={theme.colors.primary} />
          </View>
        </View>
      ) : null; })()}
      {mode === 'initial' ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              onPress={() => { setMode('signin'); setError(null); }}
              disabled={!isOnline}
              style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: !isOnline ? 0.6 : 1 }}
              accessibilityLabel="Go to sign in"
            >
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Sign In</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              onPress={() => { setMode('signup'); setError(null); }}
              disabled={!isOnline}
              style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: !isOnline ? 0.6 : 1 }}
              accessibilityLabel="Go to sign up"
            >
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {mode === 'signin' ? (
        <View style={{ marginTop: 8 }}>
          <TouchableOpacity
            onPress={onSignIn}
            disabled={isSignedIn || signingIn || !isOnline}
            style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (isSignedIn || signingIn || !isOnline) ? 0.6 : 1 }}
            accessibilityLabel="Enter"
          >
            {signingIn ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Entering…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Enter</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'signup' ? (
        <View style={{ marginTop: 8 }}>
          <TouchableOpacity
            onPress={onSignUp}
            disabled={signingUp || !isOnline}
            style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (signingUp || !isOnline) ? 0.6 : 1 }}
            accessibilityLabel="Submit sign up"
          >
            {signingUp ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Submitting…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {mode === 'signin' ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-start', marginTop: 12 }}>
          <TouchableOpacity onPress={onForgotPassword}><Text style={{ color: '#0284c7', fontWeight: '600' }}>Forgot password?</Text></TouchableOpacity>
        </View>
      ) : null}

        {isSignedIn ? (
          <View style={{ marginTop: 12 }}>
            <Button title="Sign Out" onPress={async () => { await signOut(); setIsSignedIn(false); appendLog('signed out'); }} />
          </View>
        ) : null}

        {error ? (
          <Text style={{ color: 'red', marginTop: 12, textAlign: 'center' }}>Error: {error}</Text>
        ) : null}

        {null}
        </View>
      </Animated.View>
    </View>
  );

  const { ENABLE_AUTH_GRADIENT_BG } = getFlags();
  if (ENABLE_AUTH_GRADIENT_BG) {
    return (
      <LinearGradient colors={["#FAF8F4", "#FFFFFF"]} style={{ flex: 1 }}>
        {Body}
      </LinearGradient>
    );
  }
  return Body;
}


