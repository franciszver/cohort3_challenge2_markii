import React from 'react';
import { View } from 'react-native';
import ChatHeader from '../components/ChatHeader';

export default function HomeScreen() {
  return (
    <View>
      <ChatHeader username="Your Username" />
    </View>
  );
}
