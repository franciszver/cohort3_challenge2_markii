```tsx
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

type Props = { username: string; avatar?: string };

export default function ChatHeader({ username, avatar }: Props) {
  return (
    <View style={styles.container}>
      {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.placeholder} />}
      <Text style={styles.username}>{username}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff' },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  placeholder: { width: 32, height: 32, borderRadius: 16, marginRight: 8, backgroundColor: '#ddd' },
  username: { fontSize: 16, fontWeight: '600' },
});
```
