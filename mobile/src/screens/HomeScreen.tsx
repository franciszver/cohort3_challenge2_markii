import React from 'react';
import { View, Button, Text } from 'react-native';
import ChatHeader from '../components/ChatHeader';
import { signOut } from 'aws-amplify/auth';

export default function HomeScreen({ navigation }: any) {
  return (
    <View>
      <ChatHeader username="Your Username" />
      <View style={{ padding: 16 }}>
        <Text style={{ marginBottom: 8 }}>My Home</Text>
        <Button title="Sign Out" onPress={async () => { await signOut(); navigation.replace('Auth'); }} />
      </View>
    </View>
  );
}
