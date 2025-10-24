import React, { useState } from 'react';
import { View, Button, Text, TextInput } from 'react-native';
import ChatHeader from '../components/ChatHeader';
import { getCurrentUser, signOut, fetchUserAttributes, resendSignUpCode } from 'aws-amplify/auth';
import * as Clipboard from 'expo-clipboard';
import { updateLastSeen, subscribeUserPresence } from '../graphql/users';

export default function HomeScreen({ navigation }: any) {
  const [otherUserSubInput, setOtherUserSubInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLog, setLookupLog] = useState<string | null>(null);
  const [mySub, setMySub] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState<boolean | null>(null);

  React.useEffect(() => {
    let timer: any;
    let sub: any;
    (async () => {
      try {
        const me = await getCurrentUser();
        setMySub(me.userId);
        // Fetch verification status
        try {
          const attrs: any = await fetchUserAttributes();
          const email = (attrs?.email as string) || null;
          setMyEmail(email);
          const verifiedRaw: any = (attrs as any)?.email_verified;
          const verified = verifiedRaw === true || verifiedRaw === 'true';
          setIsEmailVerified(verified);
          if (!verified && email) {
            navigation.setOptions({
              headerRight: () => (
                <Button
                  title="Verify"
                  onPress={async () => {
                    try { await resendSignUpCode({ username: email }); } catch {}
                    navigation.navigate('VerifyCode', { email });
                  }}
                />
              ),
            });
          }
        } catch {}
        await updateLastSeen(me.userId);
        // Heartbeat every 30s
        timer = setInterval(() => { updateLastSeen(me.userId).catch(() => {}); }, 30000);
        const subscribe = subscribeUserPresence(me.userId);
        sub = subscribe({ next: (evt: any) => {
          const u = evt.data.onUpdateUser;
          if (u?.lastSeen) {
            const last = new Date(u.lastSeen).getTime();
            // Online threshold: 90s
            setOnline(Date.now() - last <= 90000);
          }
        }, error: () => {} });
      } catch {}
    })();
    return () => { if (timer) clearInterval(timer); sub?.unsubscribe?.(); };
  }, []);
  return (
    <View>
      <ChatHeader username="Your Username" online={online} />
      <View style={{ padding: 16 }}>
        <Text style={{ marginBottom: 8 }}>My Home</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Show My Sub" onPress={async () => { try { const me = await getCurrentUser(); setMySub(me.userId); } catch {} }} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Copy Sub" onPress={async () => { try { let sub = mySub; if (!sub) { const me = await getCurrentUser(); sub = me.userId; setMySub(sub); } await Clipboard.setStringAsync(sub!); setCopyMsg('Copied'); setTimeout(() => setCopyMsg(null), 1500); } catch {} }} />
          </View>
        </View>
        {mySub ? <Text style={{ marginBottom: 8 }} selectable>My sub: {mySub}</Text> : null}
        {copyMsg ? <Text style={{ color: 'green', marginBottom: 8 }}>{copyMsg}</Text> : null}
        <Text style={{ marginTop: 8, marginBottom: 4 }}>Other user sub</Text>
        <TextInput
          placeholder="Enter other user's Cognito sub"
          value={otherUserSubInput}
          onChangeText={setOtherUserSubInput}
          style={{ borderWidth: 1, padding: 8, marginBottom: 8 }}
          autoCapitalize="none"
        />
        <Button
          title="Open Chat"
          onPress={async () => {
            try {
              setLookupError(null);
              setLookupLog(null);
              const otherUserSub = otherUserSubInput.trim();
              setLookupLog(JSON.stringify({ sub: otherUserSub }, null, 2));
              if (!otherUserSub) {
                setLookupError('User not found');
                return;
              }
              navigation.navigate('Chat', { otherUserSub });
            } catch (e: any) {
              const msg = e?.errors?.[0]?.message || e?.message || 'Lookup failed';
              setLookupError(msg);
            }
          }}
          disabled={!otherUserSubInput}
        />
        <View style={{ height: 8 }} />
        <Button title="Open Conversations" onPress={() => navigation.navigate('Conversations')} />
        {lookupError ? <Text style={{ color: 'red', marginTop: 8 }}>{lookupError}</Text> : null}
        {lookupLog ? (
          <View style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: '600' }}>Lookup debug:</Text>
            <Text>{lookupLog}</Text>
          </View>
        ) : null}
        <View style={{ height: 12 }} />
        <Button title="Sign Out" onPress={async () => { await signOut(); navigation.replace('Auth'); }} />
      </View>
    </View>
  );
}
