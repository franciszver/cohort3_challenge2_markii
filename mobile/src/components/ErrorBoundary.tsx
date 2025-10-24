import React from 'react';
import { View, Text, Button } from 'react-native';
import { getFlags } from '../utils/flags';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message: string | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message || 'Something went wrong' };
  }

  componentDidCatch(_error: any, _info: any) {}

  render() {
    const { ENABLE_ERROR_BOUNDARY_SCREEN } = getFlags();
    if (ENABLE_ERROR_BOUNDARY_SCREEN && this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Oops</Text>
          <Text style={{ color: '#6b7280', marginBottom: 12 }}>{this.state.message}</Text>
          <Button title="Go Home" onPress={() => { try { (global as any)?.navigation?.navigate?.('Conversations'); } catch {} this.setState({ hasError: false, message: null }); }} />
        </View>
      );
    }
    return this.props.children as any;
  }
}


