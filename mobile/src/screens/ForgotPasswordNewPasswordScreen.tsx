import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { confirmResetPassword, signIn } from 'aws-amplify/auth';

export default function ForgotPasswordNewPasswordScreen({ route, navigation }: any) {
  const { email, code } = route.params || {};
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword: password });
      try {
        await signIn({ username: email, password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } });
        navigation.replace('Home');
      } catch {
        navigation.replace('Auth');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to set new password');
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Set New Password</Text>
      <TextInput placeholder="New password" secureTextEntry value={password} onChangeText={setPassword} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <TextInput placeholder="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      {error ? <Text style={{ color: 'red', marginTop: 8 }}>{error}</Text> : null}
      <Button title="Submit" onPress={onSubmit} disabled={!password || !confirm} />
    </View>
  );
}


