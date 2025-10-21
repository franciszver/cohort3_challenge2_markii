```tsx
import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { signUp } from 'aws-amplify/auth';

export default function SignUpScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    try {
      await signUp({ username: email, password, options: { userAttributes: { email } } });
      navigation.navigate('ConfirmEmail', { email });
    } catch (e: any) {
      setError(e?.message ?? 'Sign up failed');
    }
  };

  return (
    <View>
      <Text>Sign up with email</Text>
      <TextInput placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text>{error}</Text> : null}
      <Button title="Sign Up" onPress={onSubmit} />
    </View>
  );
}
```
