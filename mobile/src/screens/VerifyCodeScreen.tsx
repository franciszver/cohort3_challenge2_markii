import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { confirmSignUp, signIn } from 'aws-amplify/auth';

export default function VerifyCodeScreen({ route, navigation }: any) {
  const { email } = route.params || {};
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');

  const append = (msg: string, payload?: any) => {
    const line = payload ? `${msg} ${JSON.stringify(payload)}` : msg;
    console.log(`[VerifyCode] ${line}`);
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
        await signIn({ username: email, password: route.params?.password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } });
        navigation.replace('Home');
      } catch (se: any) {
        append('auto signIn error', { name: se?.name, message: se?.message });
        navigation.replace('Auth');
      }
    } catch (e: any) {
      append('confirm error', { name: e?.name, message: e?.message });
      setError(e?.message ?? 'Confirmation failed');
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Verify Code</Text>
      <TextInput placeholder="Code" value={code} onChangeText={setCode} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Button title="Confirm" onPress={onConfirm} />
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


