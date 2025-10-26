import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, TouchableOpacity } from 'react-native';
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
      navigation.replace('Conversations');
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
    <View style={{ flex: 1, padding: 16 }}>
      <OfflineBanner onRetry={() => { /* no-op for auth */ }} />
      {mode !== 'initial' ? (
        <View style={{ marginBottom: 8 }}>
          <TouchableOpacity accessibilityLabel="Back to start" onPress={() => { setMode('initial'); setPassword(''); setError(null); }}>
            <Text style={{ fontSize: 16, color: '#4B5563' }}>{'← Back'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text style={{ fontSize: 30, marginBottom: 16, fontFamily: titleFontsLoaded ? 'DancingScript_700Bold' : undefined }}>NegotiatedAi</Text>
      <TextInput placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={(t)=>{ setEmail(t); try { if (getFlags().ENABLE_AUTH_UX) AsyncStorage.setItem('auth:email', t.trim()); } catch {} }} style={{ borderWidth: 1, padding: 8, marginBottom: 8, backgroundColor: 'white' }} />
      {(() => { const { ENABLE_AUTH_UX } = getFlags(); return ENABLE_AUTH_UX && emailError ? (<Text style={{ color: 'red', marginBottom: 8 }}>{emailError}</Text>) : null; })()}
      {mode !== 'initial' ? (
        <>
          <TextInput
            placeholder={mode === 'signup' ? 'Choose a password' : 'Password'}
            secureTextEntry
            value={password}
            onChangeText={(t)=>{ setPassword(t); }}
            style={{ borderWidth: 1, padding: 8, marginBottom: 8, backgroundColor: 'white' }}
          />
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
            <Button title="Sign In" onPress={() => { setMode('signin'); setError(null); }} disabled={!isOnline} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Sign Up" onPress={() => { setMode('signup'); setError(null); }} disabled={!isOnline} />
          </View>
        </View>
      ) : null}

      {mode === 'signin' ? (
        <View style={{ marginTop: 8 }}>
          <Button title={signingIn ? 'Entering…' : 'Enter'} onPress={onSignIn} disabled={isSignedIn || signingIn || !isOnline} color={theme.colors.primary} />
        </View>
      ) : null}

      {mode === 'signup' ? (
        <View style={{ marginTop: 8 }}>
          <TouchableOpacity
            onPress={onSignUp}
            disabled={signingUp || !isOnline}
            style={{
              backgroundColor: '#F2EFEA',
              padding: 10,
              borderRadius: 6,
              alignItems: 'center',
              opacity: (signingUp || !isOnline) ? 0.6 : 1,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
            accessibilityLabel="Submit sign up"
          >
            <Text style={{ color: '#2F2F2F', fontWeight: '600' }}>{signingUp ? 'Submitting…' : 'Submit'}</Text>
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
        <Text style={{ color: 'red', marginTop: 12 }}>Error: {error}</Text>
      ) : null}

      {null}
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


