import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

export default function NotificationBell({ navigation }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds

    const setupNotificationListener = () => {
      // Listen for new notifications
      const notificationsRef = collection(db, 'notifications');
      const q = query(
        notificationsRef,
        where('status', '==', 'unread'),
        orderBy('timestamp', 'desc')
      );

      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          // Reset retry count on successful connection
          retryCount = 0;
          setUnreadCount(snapshot.docs.length);
        },
        (error) => {
          console.error('Notification listener error:', error);
          
          // Attempt to reconnect if we haven't exceeded max retries
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Attempting to reconnect notification listener (${retryCount}/${maxRetries})...`);
            setTimeout(setupNotificationListener, retryDelay);
          } else {
            console.error('Max retry attempts reached for notification listener.');
            // Don't show alert for notification bell to avoid disrupting user experience
          }
        }
      );

      return unsubscribe;
    };

    const unsubscribe = setupNotificationListener();
    return () => unsubscribe();
  }, []);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => navigation.navigate('Notifications')}
    >
      <Ionicons name="notifications-outline" size={24} color="#40B59F" />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: '#FF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
}); 