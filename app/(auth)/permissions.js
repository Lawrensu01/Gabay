import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/authContext';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PermissionItem = ({ title, description, icon, granted, onRequest }) => (
  <View style={styles.permissionItem}>
    <View style={styles.permissionHeader}>
      <Ionicons name={icon} size={24} color={granted ? "#4CAF50" : "#757575"} />
      <Text style={styles.permissionTitle}>{title}</Text>
      {granted ? (
        <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
      ) : (
        <TouchableOpacity onPress={onRequest} style={styles.requestButton}>
          <Text style={styles.requestButtonText}>Allow</Text>
        </TouchableOpacity>
      )}
    </View>
    <Text style={styles.permissionDescription}>{description}</Text>
  </View>
);

const PermissionsScreen = () => {
  const router = useRouter();
  const { checkPermissionsStatus } = useAuth();
  const [permissions, setPermissions] = useState({
    location: false,
    camera: false,
    notifications: false
  });
  const [permissionsRequested, setPermissionsRequested] = useState({
    location: false,
    camera: false,
    notifications: false
  });

  useEffect(() => {
    // Set permission screen as shown to avoid redirect loops
    AsyncStorage.setItem('permissionsScreenShown', 'true');
    checkCurrentPermissions();
  }, []);

  const checkCurrentPermissions = async () => {
    try {
      // Try to load stored permission status first
      const storedPermissions = await AsyncStorage.getItem('permissionsStatus');
      if (storedPermissions) {
        const parsedPermissions = JSON.parse(storedPermissions);
        setPermissions(parsedPermissions);
        
        // If all permissions granted, we can move on
        if (Object.values(parsedPermissions).every(Boolean)) {
          setTimeout(() => handleContinue(), 500);
          return;
        }
      }
      
      // Otherwise check fresh permissions
      const locationStatus = await Location.getForegroundPermissionsAsync();
      const cameraStatus = await ImagePicker.getCameraPermissionsAsync();
      const notificationStatus = await Notifications.getPermissionsAsync();

      const currentPermissions = {
        location: locationStatus.granted,
        camera: cameraStatus.granted,
        notifications: notificationStatus.granted
      };
      
      setPermissions(currentPermissions);
      await AsyncStorage.setItem('permissionsStatus', JSON.stringify(currentPermissions));
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  const handleRequestPermission = async (type) => {
    try {
      // Mark this permission as requested to avoid duplicate dialogs
      setPermissionsRequested(prev => ({
        ...prev,
        [type]: true
      }));
      
      switch (type) {
        case 'location':
          const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
          setPermissions(prev => {
            const updated = { ...prev, location: locationStatus === 'granted' };
            AsyncStorage.setItem('permissionsStatus', JSON.stringify(updated));
            return updated;
          });
          break;
        case 'camera':
          const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
          setPermissions(prev => {
            const updated = { ...prev, camera: cameraStatus === 'granted' };
            AsyncStorage.setItem('permissionsStatus', JSON.stringify(updated));
            return updated;
          });
          break;
        case 'notifications':
          const { status: notificationStatus } = await Notifications.requestPermissionsAsync();
          setPermissions(prev => {
            const updated = { ...prev, notifications: notificationStatus === 'granted' };
            AsyncStorage.setItem('permissionsStatus', JSON.stringify(updated));
            return updated;
          });
          break;
      }
    } catch (error) {
      console.error(`Error requesting ${type} permission:`, error);
    }
  };

  const handleContinue = async () => {
    try {
      // Update permissions status in auth context
      await checkPermissionsStatus();
      
      // Store permissions in AsyncStorage to avoid asking again
      await AsyncStorage.setItem('permissionsStatus', JSON.stringify(permissions));
      
      // Determine what permissions are non-negotiable
      const requiredPermissions = ['location', 'camera']; // Notifications can be optional
      const missingRequired = requiredPermissions.filter(p => !permissions[p]);
      
      if (missingRequired.length > 0) {
        // If missing required permissions, show alert but still allow user to continue
        // This avoids trapping users in a permissions screen
        alert(
          'Some permissions were not granted which will limit app functionality. ' +
          'You can grant these later in your device settings.'
        );
      }
      
      // Navigate to the main app
      router.replace('/(app)/home');
    } catch (error) {
      console.error('Error during continue:', error);
      router.replace('/(app)/home');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>App Permissions</Text>
        <Text style={styles.subtitle}>
          To provide you with the best experience, we need the following permissions:
        </Text>
      </View>

      <View style={styles.permissionsList}>
        <PermissionItem
          title="Location"
          description="Required to show accessibility information on the map near you"
          icon="location-outline"
          granted={permissions.location}
          onRequest={() => !permissionsRequested.location && handleRequestPermission('location')}
        />

        <PermissionItem
          title="Camera"
          description="Required to take photos of accessibility features"
          icon="camera-outline"
          granted={permissions.camera}
          onRequest={() => !permissionsRequested.camera && handleRequestPermission('camera')}
        />

        <PermissionItem
          title="Notifications"
          description="Get updates about new accessibility information in your area"
          icon="notifications-outline"
          granted={permissions.notifications}
          onRequest={() => !permissionsRequested.notifications && handleRequestPermission('notifications')}
        />
      </View>

      <TouchableOpacity 
        style={styles.continueButton}
        onPress={handleContinue}
      >
        <Text style={styles.continueButtonText}>
          {Object.values(permissions).every(Boolean) ? 'Continue' : 'Continue Anyway'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  header: {
    marginTop: 40,
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#757575',
    lineHeight: 24,
  },
  permissionsList: {
    flex: 1,
    gap: 20,
  },
  permissionItem: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
  },
  permissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  permissionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginLeft: 12,
  },
  permissionDescription: {
    fontSize: 14,
    color: '#757575',
    marginLeft: 36,
  },
  requestButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  requestButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  continueButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PermissionsScreen; 