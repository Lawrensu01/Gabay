import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { checkPermissions, requestPermissions } from '../../utils/permissionsHandler';

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
  const [permissions, setPermissions] = useState({
    location: false,
    camera: false,
    notifications: false
  });

  useEffect(() => {
    checkCurrentPermissions();
  }, []);

  const checkCurrentPermissions = async () => {
    const currentPermissions = await checkPermissions();
    setPermissions(currentPermissions);
  };

  const handleRequestPermission = async (type) => {
    const results = await requestPermissions();
    setPermissions(results);
  };

  const handleContinue = () => {
    if (permissions.location && permissions.camera && permissions.notifications) {
      router.replace('/(app)/home');
    } else {
      alert('Please enable all permissions to use the app');
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
          onRequest={() => handleRequestPermission('location')}
        />

        <PermissionItem
          title="Camera"
          description="Required to take photos of accessibility features"
          icon="camera-outline"
          granted={permissions.camera}
          onRequest={() => handleRequestPermission('camera')}
        />

        <PermissionItem
          title="Notifications"
          description="Get updates about new accessibility information in your area"
          icon="notifications-outline"
          granted={permissions.notifications}
          onRequest={() => handleRequestPermission('notifications')}
        />
      </View>

      <TouchableOpacity 
        style={[
          styles.continueButton,
          !Object.values(permissions).every(Boolean) && styles.continueButtonDisabled
        ]}
        onPress={handleContinue}
        disabled={!Object.values(permissions).every(Boolean)}
      >
        <Text style={styles.continueButtonText}>Continue</Text>
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
  continueButtonDisabled: {
    backgroundColor: '#BDBDBD',
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PermissionsScreen; 