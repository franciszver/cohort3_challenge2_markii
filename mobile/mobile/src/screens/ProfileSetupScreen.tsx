import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { updateUserProfile } from '../graphql/profile';

export default function ProfileSetupScreen({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    try {
      await updateUserProfile({ username, avatar });
      navigation.replace('Home');
    } catch (e: any) {
      setError(e?.message ?? 'Profile update failed');
    }
  };

  return (
    <View>
      <Text>Set up your profile</Text>
      <TextInput placeholder="Username" value={username} onChangeText={setUsername} />
      <TextInput placeholder="Avatar URL" value={avatar} onChangeText={setAvatar} />
      {error ? <Text>{error}</Text> : null}
      <Button title="Save" onPress={onSubmit} />
    </View>
  );
}
