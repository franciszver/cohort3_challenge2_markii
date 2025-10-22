import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { signIn } from 'aws-amplify/auth';

export default function SignInScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    try {
      await signIn({ username: email, password });
      navigation.replace('Home');
    } catch (e: any) {
      setError(e?.message ?? 'Sign in failed');
    }
  };

  return (
    <View>
      <Text>Sign in</Text>
      <TextInput placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text>{error}</Text> : null}
      <Button title="Sign In" onPress={onSubmit} />
      <Button title="Sign Up" onPress={() => navigation.navigate('SignUp')} />
    </View>
  );
}
