import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signUp, confirmSignUp, signIn, fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';
import { getFlags } from '../utils/flags';
import { ensureProfileSeed } from '../graphql/profile';
import { colorForId } from '../components/Avatar';
import Constants from 'expo-constants';

export default function AuthScreen({ navigation }: any) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [code, setCode] = useState('');
  const [log, setLog] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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
      const res = await signUp({ username: email.trim(), password, options: { userAttributes: { email: email.trim(), given_name: firstName.trim(), family_name: lastName.trim() } } });
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
      // Seed UserProfile softly (flagged)
      try {
        const { ENABLE_PROFILES } = getFlags();
        if (ENABLE_PROFILES) {
          const me = await getCurrentUser();
          const avatar = colorForId(me.userId);
          await ensureProfileSeed(me.userId, { firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined, avatarColor: avatar });
        }
      } catch {}
      try { if (getFlags().ENABLE_AUTH_UX) await AsyncStorage.setItem('auth:email', email.trim()); } catch {}
      navigation.replace('Conversations');
    } catch (e: any) {
      appendLog('signIn error', { name: e?.name, message: e?.message, code: e?.code, raw: e, stack: e?.stack, cause: e?.cause });
      appendLog('env extra', (Constants.expoConfig?.extra || Constants.manifest?.extra || {}));
      setError(e?.message ?? 'Unknown sign in error');
    } finally { setSigningIn(false); }
  };

	const onForgotPassword = () => {
		navigation.navigate('ForgotPasswordRequest');
	};

  // Test comment, can be removed immeidatel

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Welcome</Text>
      <TextInput placeholder="First Name" value={firstName} onChangeText={setFirstName} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <TextInput placeholder="Last Name" value={lastName} onChangeText={setLastName} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <TextInput placeholder="Email" autoCapitalize="none" value={email} onChangeText={(t)=>{ setEmail(t); try { if (getFlags().ENABLE_AUTH_UX) AsyncStorage.setItem('auth:email', t.trim()); } catch {} }} style={{ borderWidth: 1, padding: 8, marginBottom: 4 }} />
      {(() => { const { ENABLE_AUTH_UX } = getFlags(); return ENABLE_AUTH_UX && emailError ? (<Text style={{ color: 'red', marginBottom: 8 }}>{emailError}</Text>) : null; })()}
      		<TextInput placeholder="Password" secureTextEntry value={password} onChangeText={(t)=>{ setPassword(t); }} style={{ borderWidth: 1, padding: 8, marginBottom: 4 }} />
      {(() => { const { ENABLE_AUTH_UX } = getFlags(); return ENABLE_AUTH_UX && passwordError ? (<Text style={{ color: 'red', marginBottom: 12 }}>{passwordError}</Text>) : null; })()}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button title={signingIn ? 'Signing in…' : 'Sign In'} onPress={onSignIn} disabled={isSignedIn || signingIn} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={signingUp ? 'Signing up…' : 'Sign Up'} onPress={onSignUp} disabled={signingUp} />
        </View>
      </View>

		<View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
			<View style={{ flex: 1 }}>
				<Button title="Forgot Password" onPress={onForgotPassword} />
			</View>
		</View>

      {isSignedIn ? (
        <View style={{ marginTop: 12 }}>
          <Button title="Sign Out" onPress={async () => { await signOut(); setIsSignedIn(false); appendLog('signed out'); }} />
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: 'red', marginTop: 12 }}>Error: {error}</Text>
      ) : null}

      {log ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: '600' }}>Logs:</Text>
          <Text>{log}</Text>
        </View>
      ) : null}
    </View>
  );
}


