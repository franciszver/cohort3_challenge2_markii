import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetPassword, confirmResetPassword, signIn } from 'aws-amplify/auth';
import OfflineBanner from '../components/OfflineBanner';
import NetInfo from '@react-native-community/netinfo';

export default function ForgotPasswordLinearScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    (async () => {
      try { const saved = await AsyncStorage.getItem('auth:email'); if (saved) setEmail(saved); } catch {}
    })();
    const unsub = NetInfo.addEventListener((s)=>{
      try { const offline = s.isConnected === false || s.isInternetReachable === false; setIsOnline(!offline); } catch {}
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const onRequest = async () => {
    setError(null); setBusy(true);
    try { await resetPassword({ username: email.trim() }); setStep(2); } catch (e: any) { setError(e?.message || 'Failed to send code'); }
    finally { setBusy(false); }
  };
  const onConfirm = async () => {
    setError(null); setBusy(true);
    try { await confirmResetPassword({ username: email.trim(), confirmationCode: code.trim(), newPassword: password });
      try { await signIn({ username: email.trim(), password, options: { authFlowType: 'USER_PASSWORD_AUTH' as any } }); navigation.replace('Conversations'); } catch { navigation.replace('Auth'); }
    } catch (e: any) { setError(e?.message || 'Failed to set new password'); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <OfflineBanner />
      <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Reset your password</Text>
      {step === 1 ? (
        <>
          <TextInput placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} style={{ borderWidth: 1, padding: 8, marginBottom: 12, backgroundColor: 'white' }} />
          <Button title={busy ? 'Sending…' : 'Send code'} onPress={onRequest} disabled={!email || busy || !isOnline} />
        </>
      ) : null}
      {step === 2 ? (
        <>
          <TextInput placeholder="Verification code" value={code} onChangeText={setCode} style={{ borderWidth: 1, padding: 8, marginBottom: 12, backgroundColor: 'white' }} />
          <TextInput placeholder="New password" secureTextEntry value={password} onChangeText={setPassword} style={{ borderWidth: 1, padding: 8, marginBottom: 12, backgroundColor: 'white' }} />
          <Button title={busy ? 'Submitting…' : 'Submit'} onPress={onConfirm} disabled={!code || !password || busy || !isOnline} />
        </>
      ) : null}
      {error ? <Text style={{ color: 'red', marginTop: 12 }}>{error}</Text> : null}
    </View>
  );
}


