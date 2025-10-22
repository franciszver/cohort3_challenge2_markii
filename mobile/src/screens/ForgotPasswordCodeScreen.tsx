import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

export default function ForgotPasswordCodeScreen({ route, navigation }: any) {
  const { email } = route.params || {};
  const [code, setCode] = useState('');

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Enter Verification Code</Text>
      <TextInput placeholder="Code" value={code} onChangeText={setCode} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <Button title="Continue" onPress={() => navigation.navigate('ForgotPasswordNew', { email, code })} disabled={!code} />
    </View>
  );
}


