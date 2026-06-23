import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';

let initialized = false;
let notificationsModule: typeof import('expo-notifications') | null = null;
let moduleUnavailable = false;

async function getNotificationsModule() {
  if (moduleUnavailable) return null;
  if (notificationsModule) return notificationsModule;

  // Avoid importing expo-notifications if the native module isn't in this build.
  // Dev clients without the module will throw during import, even in try/catch.
  if (!NativeModules.ExpoPushTokenManager) {
    moduleUnavailable = true;
    return null;
  }

  try {
    notificationsModule = await import('expo-notifications');
    return notificationsModule;
  } catch (error) {
    // Expo Go doesn't include expo-notifications native modules.
    moduleUnavailable = true;
    return null;
  }
}

export async function initNotifications() {
  if (initialized) return;
  initialized = true;

  if (Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient') {
    return;
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('generation', {
      name: 'Generation',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

export async function notifyGenerationComplete(title: string, body?: string) {
  if (Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient') {
    return;
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null,
    });
  } catch (error) {
    console.error('Failed to schedule notification:', error);
  }
}
