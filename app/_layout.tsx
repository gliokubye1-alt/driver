  import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { RegistrationProvider } from '@/context/RegistrationContext';
import { IncomingRidesProvider } from '@/context/IncomingRidesContext';
import GlobalRideRequestOverlay from '@/components/GlobalRideRequestOverlay';

function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const fadeAnim = new Animated.Value(0);
  const scaleAnim = new Animated.Value(0.3);
  const glowAnim = new Animated.Value(0);

  useEffect(() => {
    console.log('[v0] SplashScreen mounted');
    
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 2500,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(800),
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      console.log('[v0] SplashScreen timer finished, calling onFinish');
      onFinish();
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={splashStyles.container}>
      <Animated.View
        style={[
          splashStyles.logoContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Animated.View
          style={[
            splashStyles.glowContainer,
            {
              opacity: glowAnim,
            },
          ]}
        >
          <Text style={splashStyles.logoTextMain}>Aletwende</Text>
          <Text style={splashStyles.logoTextSub}>Driver</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowContainer: {
    alignItems: 'center',
  },
  logoTextMain: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#fff',
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    letterSpacing: 2,
  },
  logoTextSub: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#00d9ff',
    textShadowColor: 'rgba(0, 217, 255, 0.8)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 30,
    letterSpacing: 4,
    marginTop: -8,
  },
});

export default function RootLayout() {
  useFrameworkReady();
  const [showSplash, setShowSplash] = useState(true);
  
  console.log('[v0] RootLayout render, showSplash:', showSplash);

  if (showSplash) {
    return <SplashScreen onFinish={() => {
      console.log('[v0] Setting showSplash to false');
      setShowSplash(false);
    }} />;
  }

  return (
    <RegistrationProvider>
      <IncomingRidesProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="registration-terms" />
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="personal-info" />
          <Stack.Screen name="personal-picture" />
          <Stack.Screen name="step2" />
          <Stack.Screen name="step3" />
          <Stack.Screen name="cyclist-step" />
          <Stack.Screen name="license-step" />
          <Stack.Screen name="driver-license-instructions" />
          <Stack.Screen name="selfie-with-license-instructions" />
          <Stack.Screen name="id-step" />
          <Stack.Screen name="ridesDelivery" />
          <Stack.Screen name="vehicle-information" />
          <Stack.Screen name="chooseLocation" />
          <Stack.Screen name="application-submitted" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="+not-found" />
        </Stack>
        <GlobalRideRequestOverlay />
        <StatusBar style="light" />
      </IncomingRidesProvider>
    </RegistrationProvider>
  );
}
