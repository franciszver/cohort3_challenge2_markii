import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { resetPassword } from 'aws-amplify/auth';

export default function ForgotPasswordRequestScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState('');

  const append = (msg: string, payload?: any) => {
    const line = payload ? `${msg} ${JSON.stringify(payload)}` : msg;
    console.log(`[ForgotPasswordRequest] ${line}`);
    setLog(prev => `${prev}${prev ? '\n' : ''}${line}`);
  };

  const onSubmit = async () => {
    setError(null);
    const username = email.trim();
    append('resetPassword start', { username });
    try {
      const res = await resetPassword({ username });
      append('resetPassword sent', res);
      navigation.navigate('ForgotPasswordCode', { email: username });
    } catch (e: any) {
      append('resetPassword error', { name: e?.name, message: e?.message, code: e?.code });
      setError(e?.message ?? 'Failed to send reset code');
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Forgot Password</Text>
      <TextInput placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Button title="Send Code" onPress={onSubmit} disabled={!email} />
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


