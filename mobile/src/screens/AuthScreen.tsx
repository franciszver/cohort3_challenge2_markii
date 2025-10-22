import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { signUp, confirmSignUp, signIn, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import Constants from 'expo-constants';

export default function AuthScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [log, setLog] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const safe = (obj: any) => {
    try {
      return JSON.stringify(obj, Object.getOwnPropertyNames(obj));
    } catch {
      return String(obj);
    }
  };

  const appendLog = (message: string, payload?: unknown) => {
    const line = payload !== undefined ? `${message} ${safe(payload)}` : message;
    console.log(`[AuthScreen] ${line}`);
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  };

  const onSignUp = async () => {
    setError(null);
    appendLog('signUp start', { email });
    try {
      const res = await signUp({ username: email, password, options: { userAttributes: { email } } });
      appendLog('signUp success', res);
    } catch (e: any) {
      appendLog('signUp error', { name: e?.name, message: e?.message, code: e?.code });
      setError(e?.message ?? 'Unknown sign up error');
    }
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
    try {
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
      navigation.replace('Home');
    } catch (e: any) {
      appendLog('signIn error', { name: e?.name, message: e?.message, code: e?.code, raw: e, stack: e?.stack, cause: e?.cause });
      appendLog('env extra', (Constants.expoConfig?.extra || Constants.manifest?.extra || {}));
      setError(e?.message ?? 'Unknown sign in error');
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Sign Up</Text>
      <TextInput placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Button title="Sign Up" onPress={onSignUp} />

      <View style={{ height: 16 }} />
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Confirm Email</Text>
      <TextInput placeholder="Code" value={code} onChangeText={setCode} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Button title="Confirm Code" onPress={onConfirm} />

      <View style={{ height: 16 }} />
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Sign In</Text>
      <Button title="Sign In" onPress={onSignIn} />

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


