import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';

export const checkPermissions = async () => {
  const permissions = {
    location: false,
    camera: false,
    notifications: false
  };

  // Check Location Permission
  const { status: locationStatus } = await Location.getForegroundPermissionsAsync();
  permissions.location = locationStatus === 'granted';

  // Check Camera Permission
  const { status: cameraStatus } = await ImagePicker.getCameraPermissionsAsync();
  permissions.camera = cameraStatus === 'granted';

  // Check Notifications Permission
  const { status: notificationStatus } = await Notifications.getPermissionsAsync();
  permissions.notifications = notificationStatus === 'granted';

  return permissions;
};

export const requestPermissions = async () => {
  const results = {
    location: false,
    camera: false,
    notifications: false
  };

  // Request Location Permission
  const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
  results.location = locationStatus === 'granted';

  // Request Camera Permission
  const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
  results.camera = cameraStatus === 'granted';

  // Request Notifications Permission
  const { status: notificationStatus } = await Notifications.requestPermissionsAsync();
  results.notifications = notificationStatus === 'granted';

  return results;
}; 