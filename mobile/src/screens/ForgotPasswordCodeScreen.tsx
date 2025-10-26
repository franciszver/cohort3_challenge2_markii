import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useTheme } from '../utils/theme';

export default function ForgotPasswordCodeScreen({ route, navigation }: any) {
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const { email } = route.params || {};
  const [code, setCode] = useState('');
  const [codeFocused, setCodeFocused] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ width: '100%', maxWidth: 420, opacity: fadeAnim }}>
        <View style={{ padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Verification code</Text>
          <TextInput
            placeholder="Enter code"
            value={code}
            onChangeText={setCode}
            returnKeyType="go"
            onFocus={() => setCodeFocused(true)}
            onBlur={() => setCodeFocused(false)}
            onSubmitEditing={() => { if (code && !isContinuing) { setIsContinuing(true); navigation.navigate('ForgotPasswordNew', { email, code }); setIsContinuing(false); } }}
            style={{ borderWidth: 1, padding: 10, marginBottom: 8, backgroundColor: 'white', borderColor: codeFocused ? theme.colors.primary : theme.colors.border, borderRadius: 8 }}
          />

          <TouchableOpacity
            onPress={() => { if (!code) return; setIsContinuing(true); navigation.navigate('ForgotPasswordNew', { email, code }); setIsContinuing(false); }}
            disabled={!code || isContinuing}
            style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!code || isContinuing) ? 0.6 : 1 }}
            accessibilityLabel="Continue to set new password"
          >
            {isContinuing ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.colors.textPrimary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Continuing…</Text>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}


