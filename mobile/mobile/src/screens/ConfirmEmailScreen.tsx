import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { confirmSignUp } from 'aws-amplify/auth';

export default function ConfirmEmailScreen({ route, navigation }: any) {
  const { email } = route.params || {};
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      navigation.navigate('SignIn');
    } catch (e: any) {
      setError(e?.message ?? 'Confirmation failed');
    }
  };

  return (
    <View>
      <Text>Confirm your email</Text>
      <TextInput placeholder="Code" value={code} onChangeText={setCode} />
      {error ? <Text>{error}</Text> : null}
      <Button title="Confirm" onPress={onSubmit} />
    </View>
  );
}
