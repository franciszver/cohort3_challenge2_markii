import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { confirmSignUp, signIn, resendSignUpCode } from 'aws-amplify/auth';

export default function VerifyCodeScreen({ route, navigation }: any) {
  const initialEmail = (route?.params?.email as string | undefined) || '';
  const initialPassword = (route?.params?.password as string | undefined) || '';
  const [email, setEmail] = useState<string>(initialEmail);
  const [password] = useState<string>(initialPassword);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [isResending, setIsResending] = useState(false);

  const append = (msg: string, payload?: any) => {
    const line = payload ? `${msg} ${JSON.stringify(payload)}` : msg;
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  };

  const onConfirm = async () => {
    setError(null);
    append('confirm start', { email });
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      append('confirm success');
      // Auto sign in
      try {
        if (password) {
          await signIn({ username: email, password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } });
          navigation.replace('Conversations');
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
    }
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
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Verify Code</Text>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <TextInput placeholder="Code" value={code} onChangeText={setCode} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Button title="Confirm" onPress={onConfirm} disabled={!email || !code} />
      <View style={{ height: 8 }} />
      <Button title={isResending ? 'Resending…' : 'Resend Code'} onPress={onResend} disabled={!email || isResending} />
      {error ? <Text style={{ color: 'red', marginTop: 12 }}>{error}</Text> : null}
      {log ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: '600' }}>Logs:</Text>
          <Text>{log}</Text>
        </View>
      ) : null}
    </View>
  );
}


