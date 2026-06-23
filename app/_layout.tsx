import '@/shims/crypto-random-uuid';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { Colors } from '@/constants/Colors';
import '@/global.css';
import { useResolvedTheme, useThemeStore } from '@/store/theme';
import { IncomingShareListener } from '@/components/incoming-share-listener';
import { initNotifications } from '@/utils/notifications';
import { toastConfig } from '@/utils/toast';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://98d5701ad9a66997c72863211e66306a@o4509226334683136.ingest.us.sentry.io/4510933704048640',
  sendDefaultPii: false,
  enableLogs: true,

  // Session Replay — record 10% of sessions, 100% on error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],
});

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// disable reanimated logger
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false, // Reanimated runs in strict mode by default
});

const CustomDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.background[0],
  },
};

const CustomLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background[0],
  },
};

function RootLayoutNav() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  const insets = useSafeAreaInsets();
  const preference = useThemeStore((s) => s.preference);
  const colorScheme = useResolvedTheme();

  useEffect(() => {
    initNotifications().catch((error) => {
      console.warn('Notification init failed:', error);
    });
  }, []);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
        <GluestackUIProvider mode={preference}>
          <ThemeProvider value={colorScheme === 'dark' ? CustomDarkTheme : CustomLightTheme}>
              <BottomSheetModalProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="generate/setup" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="+not-found"
                    options={{ headerShown: false }}
                  />
                </Stack>
              </BottomSheetModalProvider>

              <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
              <IncomingShareListener />
          </ThemeProvider>
        </GluestackUIProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
      <Toast config={toastConfig} topOffset={insets.top + 8} />
    </>
  );
}

export default Sentry.wrap(RootLayoutNav);
