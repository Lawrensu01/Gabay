import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Alert, ActivityIndicator, Image, Platform, Linking } from 'react-native';
import MapView, { Circle, Heatmap } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../../context/authContext';
import { collection, addDoc, getDocs, query, where, getDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useFocusEffect } from '@react-navigation/native';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Gyroscope } from 'expo-sensors';
import { router } from 'expo-router';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const BottomSheetHeader = ({ title, onClose }) => (
  <View style={styles.bottomSheetHeader}>
    <View style={styles.bottomSheetIndicator} />
    <Text style={styles.bottomSheetTitle}>{title}</Text>
    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
      <Ionicons name="close" size={24} color="#9E9E9E" />
    </TouchableOpacity>
  </View>
);

const Legend = () => (
  <View style={styles.legendContainer}>
    <View style={styles.legendHeader}>
      <Ionicons name="color-palette-outline" size={20} color="#424242" />
      <Text style={styles.legendTitle}>Accessibility Levels</Text>
    </View>
    <View style={styles.legendItems}>
      <View style={styles.legendItem}>
        <View style={[styles.legendColor, { backgroundColor: '#4CAF50' }]} />
        <Text style={styles.legendText}>Accessible</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendColor, { backgroundColor: '#FFC107' }]} />
        <Text style={styles.legendText}>Partially Accessible</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendColor, { backgroundColor: '#F44336' }]} />
        <Text style={styles.legendText}>Inaccessible</Text>
      </View>
    </View>
  </View>
);

const FilterButton = ({ icon, label, isActive, onPress }) => (
  <TouchableOpacity
    style={[styles.filterButton, isActive && styles.activeFilter]}
    onPress={onPress}
  >
    <Ionicons 
      name={icon} 
      size={18} 
      color={isActive ? "white" : "#1976D2"} 
    />
    <Text style={[styles.filterText, isActive && styles.activeFilterText]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const AccessibilityMap = () => {
  // State management
  const [location, setLocation] = useState(null);
  const [feedbacks, setFeedbacks] = useState([]);
  const [addingFeedback, setAddingFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState(null);
  const [comment, setComment] = useState('');
  const [selectedFilters, setSelectedFilters] = useState({
    wheelchairRamps: false,
    elevators: false,
    chairs: false,
    widePathways: false,
    pwdRestrooms: false,
  });
  const [activeFilters, setActiveFilters] = useState([]);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [heatmapData, setHeatmapData] = useState([]);
  const [panoramaImage, setPanoramaImage] = useState(null);
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState([]);
  const [error, setError] = useState(null);

  // Refs
  const locationWatchRef = useRef(null);

  // Memoized functions
  const cleanupLocationWatch = useCallback(() => {
    if (locationWatchRef.current) {
      locationWatchRef.current.remove();
      locationWatchRef.current = null;
    }
  }, []);

  const setupLocationWatch = useCallback(async () => {
    try {
      cleanupLocationWatch();
      
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (newLocation) => {
          if (newLocation && newLocation.coords) {
            setLocation(prev => ({
              ...prev,
              latitude: newLocation.coords.latitude,
              longitude: newLocation.coords.longitude,
            }));
          }
        }
      );

      locationWatchRef.current = subscription;
    } catch (error) {
      console.warn("Error setting up location watch:", error);
    }
  }, [cleanupLocationWatch]);

  const initializeLocationServices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // First check if location services are enabled
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        if (Platform.OS === 'ios') {
          Linking.openURL('app-settings:');
        } else {
          Linking.openSettings();
        }
        setError("Location services are disabled. Please enable them in your device settings.");
        return;
      }

      // Then check for location permission
      const { status: existingStatus } = await Location.getForegroundPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        if (Platform.OS === 'ios') {
          Linking.openURL('app-settings:');
        } else {
          Linking.openSettings();
        }
        setError("Location permission is required. Please grant permission in your device settings.");
        return;
      }

      // Try to get current location with retries and fallback
      let retries = 3;
      let currentLocation = null;
      let accuracy = Location.Accuracy.High;

      while (retries > 0 && !currentLocation) {
        try {
          currentLocation = await Location.getCurrentPositionAsync({
            accuracy: accuracy,
            timeout: 15000,
            mayShowUserSettingsDialog: true
          });
        } catch (error) {
          console.warn(`Location attempt ${4 - retries} failed:`, error);
          retries--;
          
          // If high accuracy fails, try with balanced accuracy
          if (retries === 1) {
            accuracy = Location.Accuracy.Balanced;
          }
          
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          }
        }
      }

      if (!currentLocation) {
        // Try to get last known location as fallback
        try {
          const lastKnownLocation = await Location.getLastKnownPositionAsync({
            maxAge: 30000 // 30 seconds
          });
          
          if (lastKnownLocation) {
            currentLocation = lastKnownLocation;
          } else {
            setError("Unable to get your location. Please check your GPS signal and try again.");
            return;
          }
        } catch (error) {
          console.error("Error getting last known location:", error);
          setError("Unable to get your location. Please check your GPS signal and try again.");
          return;
        }
      }

      // Validate location coordinates
      if (!currentLocation.coords || 
          typeof currentLocation.coords.latitude !== 'number' || 
          typeof currentLocation.coords.longitude !== 'number') {
        setError("Invalid location data received. Please try again.");
        return;
      }

      // Set the location state with initial region
      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });

      // Setup location watching
      await setupLocationWatch();

    } catch (error) {
      console.error("Error initializing location:", error);
      setError("Failed to initialize location services. Please check your location settings and try again.");
    } finally {
      setLoading(false);
    }
  }, [setupLocationWatch]);

  const handleRefreshLocation = useCallback(async () => {
    setError(null);
    await initializeLocationServices();
  }, [initializeLocationServices]);

  // Effects
  useEffect(() => {
    initializeLocationServices();
    return cleanupLocationWatch;
  }, [initializeLocationServices, cleanupLocationWatch]);

  useFocusEffect(
    useCallback(() => {
      const refreshData = async () => {
        await fetchInitialFeedback();
        if (isAdmin) {
          await fetchPendingFeedback();
        }
      };
      
      refreshData();
    }, [isAdmin])
  );

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user) return;
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      setIsAdmin(userDoc.data()?.isAdmin || false);
    };
    checkAdminStatus();
  }, [user]);

  useEffect(() => {
    if (isAdmin) {
      fetchPendingFeedback();
    }
  }, [isAdmin]);

  useEffect(() => {
    const registerForPushNotifications = async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        
        if (finalStatus !== 'granted') {
          return;
        }

        // Get the token
        const token = (await Notifications.getExpoPushTokenAsync()).data;

        // Store it in Firestore if user is logged in
        if (user) {
          await updateDoc(doc(db, 'users', user.uid), {
            expoPushToken: token
          });
        }
      } catch (error) {
        console.error('Error registering for push notifications:', error);
      }
    };

    registerForPushNotifications();
  }, [user]); // Only run when user changes

  // Modify fetchAccessibilityFeedback to use mock data or local storage
  const fetchInitialFeedback = async () => {
    try {
      setLoading(true);
      // Clear previous data
      setFeedbacks([]);
      setHeatmapData([]);
      
      const feedbackRef = collection(db, 'accessibility_feedback');
      const q = query(feedbackRef, where('status', '==', 'approved'));
      const querySnapshot = await getDocs(q);
      
      const fetchedFeedback = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setFeedbacks(fetchedFeedback);
      
      // Create heatmap points with error handling
      const heatmapPoints = fetchedFeedback.map(data => {
        try {
          return {
            latitude: data.coordinate.latitude,
            longitude: data.coordinate.longitude,
            weight: data.type === 'accessible' ? 1.0 :
                    data.type === 'partially' ? 0.5 : 0.2
          };
        } catch (error) {
          console.error("Error processing feedback point:", error);
          return null;
        }
      }).filter(point => point !== null);
      
      setHeatmapData(heatmapPoints);
    } catch (error) {
      console.error("Error fetching feedback:", error);
      Alert.alert(
        "Error",
        "Failed to load accessibility data. Please try again.",
        [{ text: "OK" }]
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingFeedback = async () => {
    try {
      const feedbackRef = collection(db, 'accessibility_feedback');
      const q = query(feedbackRef, where('status', '==', 'pending'));
      const querySnapshot = await getDocs(q);
      
      setPendingFeedback(querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })));
    } catch (error) {
      console.error("Error fetching pending feedback:", error);
    }
  };

  // Calculate distance between two coordinates in meters
  const calculateDistance = (coord1, coord2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (coord1.latitude * Math.PI) / 180;
    const φ2 = (coord2.latitude * Math.PI) / 180;
    const Δφ = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const Δλ = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
  };

  // Check if a new feedback location is too close to existing ones
  const isTooCloseToExistingFeedback = (newCoord) => {
    // Check distance against all existing feedback
    for (const feedback of feedbacks) {
      const distance = calculateDistance(newCoord, feedback.coordinate);
      // If distance is less than 3 meters (the radius of our circles)
      if (distance < 3) {
        return true;
      }
    }
    return false;
  };

  // Modify the takePanoramaPhoto function
  const takePanoramaPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required to take photos');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: Platform.OS === 'android' ? 0.7 : 0.5,
        allowsEditing: false,
        exif: true,
        base64: true
      });

      if (!result.canceled && result.assets[0]) {
        setPanoramaImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to capture photo');
    }
  };

  // Update the Heatmap component to use single color based on type
  const getHeatmapGradient = (type) => {
    switch (type) {
      case 'accessible':
        return {
          colors: ['rgba(76, 175, 80, 0)', 'rgba(76, 175, 80, 0.6)', '#4CAF50'],
          startPoints: [0, 0.5, 1],
        };
      case 'partially':
        return {
          colors: ['rgba(255, 193, 7, 0)', 'rgba(255, 193, 7, 0.6)', '#FFC107'],
          startPoints: [0, 0.5, 1],
        };
      case 'inaccessible':
        return {
          colors: ['rgba(244, 67, 54, 0)', 'rgba(244, 67, 54, 0.6)', '#F44336'],
          startPoints: [0, 0.5, 1],
        };
      default:
        return {
          colors: ['rgba(76, 175, 80, 0)', 'rgba(76, 175, 80, 0.6)', '#4CAF50'],
          startPoints: [0, 0.5, 1],
        };
    }
  };

  // Add this function to handle FCM token registration
  const registerDeviceForMessaging = async () => {
    try {
      if (Platform.OS === 'ios') {
        const authStatus = await Notifications.requestPermissionsAsync();
        const enabled =
          authStatus.status === Notifications.AuthorizationStatus.AUTHORIZED ||
          authStatus.status === Notifications.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
          return;
        }
      }

      // Get the FCM token
      const token = await Notifications.getExpoPushTokenAsync();
      if (token && user) {
        // Store the token in Firestore
        await updateDoc(doc(db, 'users', user.uid), {
          fcmToken: token.data
        });
      }

      // Listen to token refresh
      Notifications.addNotificationReceivedListener(async (newToken) => {
        if (user) {
          await updateDoc(doc(db, 'users', user.uid), {
            fcmToken: newToken.data
          });
        }
      });
    } catch (error) {
      console.error('Error registering for FCM:', error);
    }
  };

  // Add this function to send notifications
  const sendFeedbackNotification = async (feedbackType, location) => {
    try {
      // Create a new notification in Firestore
      await addDoc(collection(db, 'notifications'), {
        title: 'New Accessibility Feedback',
        body: `New ${feedbackType} location feedback has been added`,
        timestamp: new Date().toISOString(),
        type: 'new_feedback',
        location: location,
        status: 'unread'
      });
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  };

  // Add this function to schedule a local notification
  const showLocalNotification = async (title, body) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: title,
          body: body,
          data: { data: 'goes here' },
        },
        trigger: null, // null means show immediately
      });
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  };

  // Update the processImage function to use fetch and base64 conversion
  const processImage = async (uri) => {
    try {
      // Fetch the image
      const response = await fetch(uri);
      const blob = await response.blob();
      
      // Convert blob to base64
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64data = reader.result.split(',')[1];
          resolve(base64data);
        };
        reader.onerror = () => reject(new Error('Failed to convert image'));
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  };

  // Simplify the addFeedback function
  const addFeedback = async () => {
    if (!location || !feedbackType || !panoramaImage) {
      Alert.alert("Missing Information", "Please provide accessibility type and photo");
      return;
    }

    try {
      setLoading(true);

      // Create the feedback object
      const newFeedback = {
        coordinate: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        type: feedbackType,
        features: feedbackType === 'partially' 
          ? Object.keys(selectedFilters).filter(key => selectedFilters[key])
          : [],
        panoramaImage: panoramaImage,
        comment: comment,
        timestamp: new Date().toISOString(),
        status: 'pending',
        userId: user.uid,
        userName: user.displayName || 'Anonymous'
      };

      // Add to Firestore
      const feedbackRef = collection(db, 'accessibility_feedback');
      await addDoc(feedbackRef, newFeedback);

      Alert.alert(
        "Success", 
        "Feedback submitted for review. An admin will verify your submission."
      );
      resetFeedbackForm();

    } catch (error) {
      console.error('Error submitting feedback:', error);
      Alert.alert("Error", "Failed to submit feedback");
    } finally {
      setLoading(false);
    }
  };

  // Reset feedback form
  const resetFeedbackForm = () => {
    setAddingFeedback(false);
    setFeedbackType(null);
    setComment('');
    setSelectedFilters({
      wheelchairRamps: false,
      elevators: false,
      chairs: false,
      widePathways: false,
      pwdRestrooms: false,
    });
    setPanoramaImage(null);
  };

  // Toggle a filter for viewing feedbacks
  const toggleViewFilter = (filter) => {
    if (activeFilters.includes(filter)) {
      setActiveFilters(activeFilters.filter(f => f !== filter));
    } else {
      setActiveFilters([...activeFilters, filter]);
    }
  };

  // Toggle a filter for adding feedback
  const toggleAddFilter = (filter) => {
    setSelectedFilters({
      ...selectedFilters,
      [filter]: !selectedFilters[filter],
    });
  };

  // Get color based on accessibility type
  const getColorByType = (type) => {
    switch (type) {
      case 'accessible': return 'rgba(76, 175, 80, 0.3)';  // #4CAF50
      case 'partially': return 'rgba(255, 193, 7, 0.3)';   // #FFC107
      case 'inaccessible': return 'rgba(244, 67, 54, 0.3)'; // #F44336
      default: return 'rgba(158, 158, 158, 0.3)';          // #9E9E9E
    }
  };

  // Get border color based on accessibility type
  const getBorderColorByType = (type) => {
    switch (type) {
      case 'accessible': return '#4CAF50';
      case 'partially': return '#FFC107';
      case 'inaccessible': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  // Handle circle press to show feedback details
  const handleCirclePress = (feedback) => {
    setSelectedFeedback(feedback);
    setModalVisible(true);
  };

  // Check if feedback should be displayed based on active filters
  const shouldDisplayFeedback = (feedback) => {
    if (activeFilters.length === 0) return true;
    return feedback.features.some(feature => activeFilters.includes(feature));
  };

  // Get accessibility type label
  const getAccessibilityTypeLabel = (type) => {
    switch (type) {
      case 'accessible': return 'Accessible';
      case 'partially': return 'Partially Accessible';
      case 'inaccessible': return 'Inaccessible';
      default: return 'Unknown';
    }
  };

  // Get feature label
  const getFeatureLabel = (feature) => {
    switch (feature) {
      case 'wheelchairRamps': return 'Wheelchair Ramps';
      case 'elevators': return 'Elevators';
      case 'chairs': return 'Chairs';
      case 'widePathways': return 'Wide Pathways';
      default: return feature;
    }
  };

  // Separate utility function for creating heatmap point
  const createHeatmapPoint = (coordinate, type) => ({
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    weight: type === 'accessible' ? 1.0 : type === 'partially' ? 0.5 : 0.2
  });

  // Update the handleNormalApproval function
  const handleNormalApproval = async (feedbackId, newFeedback) => {
    try {
      await updateDoc(doc(db, 'accessibility_feedback', feedbackId), {
        status: 'approved',
        reviewedBy: user.uid,
        reviewedAt: new Date().toISOString()
      });

      const approvedFeedback = {
        id: feedbackId,
        ...newFeedback,
        status: 'approved'
      };
      
      setFeedbacks(prev => [...prev, approvedFeedback]);
      setHeatmapData(prev => [...prev, createHeatmapPoint(newFeedback.coordinate, newFeedback.type)]);

      // Show notification
      await showLocalNotification(
        'Feedback Approved',
        `A new ${newFeedback.type} location has been approved!`
      );

      Alert.alert("Success", `New ${newFeedback.type} location has been approved`);
      setModalVisible(false);
      fetchInitialFeedback();
      fetchPendingFeedback();
    } catch (error) {
      console.error('Error approving feedback:', error);
      Alert.alert("Error", "Failed to approve feedback");
    }
  };

  // Update the handleOverride function
  const handleOverride = async (existingFeedback, newFeedbackId, newFeedback) => {
    try {
      // Delete existing feedback
      await deleteDoc(doc(db, 'accessibility_feedback', existingFeedback.id));
      
      // Update local states to remove old feedback
      setFeedbacks(prev => prev.filter(f => f.id !== existingFeedback.id));
      setHeatmapData(prev => prev.filter(point => 
        point.latitude !== existingFeedback.coordinate.latitude ||
        point.longitude !== existingFeedback.coordinate.longitude
      ));

      // Approve new feedback
      await updateDoc(doc(db, 'accessibility_feedback', newFeedbackId), {
        status: 'approved',
        reviewedBy: user.uid,
        reviewedAt: new Date().toISOString()
      });

      // Add new feedback to local states
      const approvedFeedback = {
        id: newFeedbackId,
        ...newFeedback,
        status: 'approved'
      };
      
      setFeedbacks(prev => [...prev, approvedFeedback]);
      setHeatmapData(prev => [...prev, createHeatmapPoint(newFeedback.coordinate, newFeedback.type)]);

      Alert.alert("Success", `Location has been updated to ${newFeedback.type} accessibility status`);
      
      setModalVisible(false);
      fetchInitialFeedback();
      fetchPendingFeedback();
    } catch (error) {
      console.error('Error overriding feedback:', error);
      Alert.alert("Error", "Failed to override feedback");
    }
  };

  // Update the handleRejectFeedback function
  const handleRejectFeedback = async (feedbackId) => {
    try {
      Alert.alert(
        "Reject Feedback",
        "Are you sure you want to reject this feedback? This action cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reject",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteDoc(doc(db, 'accessibility_feedback', feedbackId));
                Alert.alert("Success", "Feedback has been successfully rejected");
                
                setModalVisible(false);
                fetchPendingFeedback();
              } catch (error) {
                console.error('Error deleting rejected feedback:', error);
                Alert.alert("Error", "Failed to reject feedback");
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error rejecting feedback:', error);
      Alert.alert("Error", "Failed to process rejection");
    }
  };

  // Update the NotificationListener component
  const NotificationListener = () => {
    useEffect(() => {
      // Remove any messaging.onMessage listeners if they exist
      
      // Replace with Expo notifications listener
      const subscription = Notifications.addNotificationReceivedListener(notification => {
        console.log('Notification received:', notification);
        // Handle your notification here
      });

      // Cleanup
      return () => {
        subscription.remove();
      };
    }, []);

    return null;
  };

  if (!location) {
    return (
      <View style={styles.container}>
        <Text>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={24} color="#F44336" />
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.errorButtons}>
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={handleRefreshLocation}
            >
              <Ionicons name="refresh" size={20} color="white" />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.settingsButton}
              onPress={() => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              }}
            >
              <Ionicons name="settings-outline" size={20} color="white" />
              <Text style={styles.settingsButtonText}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <MapView
        style={styles.map}
        initialRegion={location}
        showsUserLocation={true}
        showsCompass={false}
        showsMyLocationButton={false}
        showsScale={false}
        showsBuildings={false}
        showsTraffic={false}
        showsIndoors={false}
        toolbarEnabled={false}
      >
        {/* Split heatmaps by type with error handling */}
        {['accessible', 'partially', 'inaccessible'].map(type => {
          try {
            const typePoints = heatmapData.filter(point => 
              feedbacks.find(f => 
                f.coordinate.latitude === point.latitude && 
                f.coordinate.longitude === point.longitude
              )?.type === type
            );
            
            return typePoints.length > 0 ? (
              <Heatmap
                key={type}
                points={typePoints}
                radius={50}
                opacity={0.7}
                gradient={getHeatmapGradient(type)}
              />
            ) : null;
          } catch (error) {
            console.error(`Error rendering heatmap for type ${type}:`, error);
            return null;
          }
        })}
        
        {/* Render feedback circles with error handling */}
        {feedbacks.filter(shouldDisplayFeedback).map((feedback) => {
          try {
            return (
              <Circle
                key={feedback.id}
                center={feedback.coordinate}
                radius={3}
                fillColor={getColorByType(feedback.type)}
                strokeWidth={1}
                strokeColor={getBorderColorByType(feedback.type)}
                tappable={true}
                onPress={() => handleCirclePress(feedback)}
              />
            );
          } catch (error) {
            console.error(`Error rendering feedback circle for ${feedback.id}:`, error);
            return null;
          }
        })}
      </MapView>

      <Legend />

      <TouchableOpacity
        style={styles.addButton}
        onPress={() => setAddingFeedback(true)}
      >
        <Ionicons name="add" size={24} color="white" />
      </TouchableOpacity>

      {isAdmin && (
        <TouchableOpacity
          style={styles.adminButton}
          onPress={() => setModalVisible(true)}
        >
          <Ionicons name="shield-checkmark" size={24} color="white" />
          <Text style={styles.adminButtonText}>
            Admin Panel ({pendingFeedback.length})
          </Text>
        </TouchableOpacity>
      )}

      {/* Bottom Sheet Modal */}
      {addingFeedback && (
        <View style={styles.bottomSheet}>
          <BottomSheetHeader 
            title="Add Accessibility Feedback" 
            onClose={resetFeedbackForm}
          />
          
          <Text style={styles.sectionTitle}>Accessibility Type</Text>
          <View style={styles.typeButtons}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                feedbackType === 'accessible' && styles.accessibleButton
              ]}
              onPress={() => {
                setFeedbackType('accessible');
                // Reset features when switching to accessible
                setSelectedFilters({
                  wheelchairRamps: false,
                  elevators: false,
                  chairs: false,
                  widePathways: false,
                  pwdRestrooms: false,
                });
              }}
            >
              <Text style={[styles.typeButtonText, feedbackType === 'accessible' && styles.activeTypeText]}>
                Accessible
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.typeButton,
                feedbackType === 'partially' && styles.partiallyButton
              ]}
              onPress={() => setFeedbackType('partially')}
            >
              <Text style={[styles.typeButtonText, feedbackType === 'partially' && styles.activeTypeText]}>
                Partially
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.typeButton,
                feedbackType === 'inaccessible' && styles.inaccessibleButton
              ]}
              onPress={() => {
                setFeedbackType('inaccessible');
                // Reset features when switching to inaccessible
                setSelectedFilters({
                  wheelchairRamps: false,
                  elevators: false,
                  chairs: false,
                  widePathways: false,
                  pwdRestrooms: false,
                });
              }}
            >
              <Text style={[styles.typeButtonText, feedbackType === 'inaccessible' && styles.activeTypeText]}>
                Inaccessible
              </Text>
            </TouchableOpacity>
          </View>

          {/* Only show features section when "Partially" is selected */}
          {feedbackType === 'partially' && (
            <>
              <Text style={styles.sectionTitle}>Available Features <Text style={styles.requiredText}>*</Text></Text>
              <View style={styles.featureButtons}>
                <TouchableOpacity
                  style={[
                    styles.featureButton,
                    selectedFilters.wheelchairRamps && styles.selectedFeature
                  ]}
                  onPress={() => toggleAddFilter('wheelchairRamps')}
                >
                  <Ionicons 
                    name="accessibility-outline"
                    size={20} 
                    color={selectedFilters.wheelchairRamps ? "white" : "#424242"} 
                  />
                  <Text style={[
                    styles.featureButtonText,
                    selectedFilters.wheelchairRamps && styles.selectedFeatureText
                  ]}>
                    Wheelchair Ramps
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.featureButton,
                    selectedFilters.elevators && styles.selectedFeature
                  ]}
                  onPress={() => toggleAddFilter('elevators')}
                >
                  <Ionicons 
                    name="arrow-up-outline"
                    size={20} 
                    color={selectedFilters.elevators ? "white" : "#424242"} 
                  />
                  <Text style={[
                    styles.featureButtonText,
                    selectedFilters.elevators && styles.selectedFeatureText
                  ]}>
                    Elevators
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.featureButton,
                    selectedFilters.chairs && styles.selectedFeature
                  ]}
                  onPress={() => toggleAddFilter('chairs')}
                >
                  <Ionicons 
                    name="home-outline"
                    size={20} 
                    color={selectedFilters.chairs ? "white" : "#424242"} 
                  />
                  <Text style={[
                    styles.featureButtonText,
                    selectedFilters.chairs && styles.selectedFeatureText
                  ]}>
                    Chairs
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.featureButton,
                    selectedFilters.widePathways && styles.selectedFeature
                  ]}
                  onPress={() => toggleAddFilter('widePathways')}
                >
                  <Ionicons 
                    name="resize-outline"
                    size={20} 
                    color={selectedFilters.widePathways ? "white" : "#424242"} 
                  />
                  <Text style={[
                    styles.featureButtonText,
                    selectedFilters.widePathways && styles.selectedFeatureText
                  ]}>
                    Wide Pathways
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.featureButton,
                    selectedFilters.pwdRestrooms && styles.selectedFeature
                  ]}
                  onPress={() => toggleAddFilter('pwdRestrooms')}
                >
                  <Ionicons 
                    name="water-outline"
                    size={20} 
                    color={selectedFilters.pwdRestrooms ? "white" : "#424242"} 
                  />
                  <Text style={[
                    styles.featureButtonText,
                    selectedFilters.pwdRestrooms && styles.selectedFeatureText
                  ]}>
                    PWD Restrooms
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Panorama Photo <Text style={styles.requiredText}>*</Text></Text>
          {panoramaImage ? (
            <View style={styles.imagePreviewContainer}>
              <Image 
                source={{ uri: panoramaImage }} 
                style={styles.imagePreview} 
              />
              <TouchableOpacity 
                style={styles.retakeButton}
                onPress={() => setPanoramaImage(null)}
              >
                <Ionicons name="camera-reverse" size={20} color="white" />
                <Text style={styles.retakeButtonText}>Retake</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.takePhotoButton}
              onPress={takePanoramaPhoto}
            >
              <Ionicons name="camera" size={24} color="#2196F3" />
              <Text style={styles.takePhotoText}>Take Photo</Text>
            </TouchableOpacity>
          )}

          <TextInput
            style={styles.commentInput}
            placeholder="Additional comments (optional)"
            value={comment}
            onChangeText={setComment}
            multiline
          />

          <View style={styles.formButtons}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={resetFeedbackForm}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.submitButton,
                (
                  !feedbackType || 
                  !panoramaImage || 
                  (feedbackType === 'partially' && Object.keys(selectedFilters).filter(key => selectedFilters[key]).length === 0)
                ) && styles.disabledButton
              ]}
              onPress={addFeedback}
              disabled={
                !feedbackType || 
                !panoramaImage || 
                (feedbackType === 'partially' && Object.keys(selectedFilters).filter(key => selectedFilters[key]).length === 0)
              }
            >
              <Text style={styles.buttonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Feedback Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible && !isAdmin}
        onRequestClose={() => {
          setModalVisible(false);
          setSelectedFeedback(null);
        }}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            {selectedFeedback && (
              <>
                <View style={[styles.modalHeader, {
                  backgroundColor: 
                    selectedFeedback.type === 'accessible' ? 'green' :
                    selectedFeedback.type === 'partially' ? 'orange' : 'red'
                }]}>
                  <Text style={styles.modalTitle}>
                    {getAccessibilityTypeLabel(selectedFeedback.type)}
                  </Text>
                </View>
                
                {selectedFeedback.features.length > 0 && (
                  <View style={styles.featuresContainer}>
                    <Text style={styles.sectionTitle}>Features:</Text>
                    {selectedFeedback.features.map((feature, index) => (
                      <View key={index} style={styles.featureItem}>
                        <Ionicons 
                          name={
                            feature === 'wheelchairRamps' ? 'accessibility-outline' :
                            feature === 'elevators' ? 'arrow-up-outline' :
                            feature === 'chairs' ? 'home-outline' :
                            feature === 'pwdRestrooms' ? 'water-outline' :
                            'resize-outline'
                          } 
                          size={20} 
                          color={selectedFilters[feature] ? "white" : "#424242"} 
                        />
                        <Text style={styles.featureItemText}>{getFeatureLabel(feature)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                
                {selectedFeedback.comment && (
                  <View style={styles.commentContainer}>
                    <Text style={styles.sectionTitle}>Comment:</Text>
                    <Text style={styles.commentText}>{selectedFeedback.comment}</Text>
                  </View>
                )}
                
                {selectedFeedback && selectedFeedback.panoramaImage && (
                  <View style={styles.photoContainer}>
                    <Text style={styles.sectionTitle}>Location Photo:</Text>
                    <Image 
                      source={{ uri: selectedFeedback.panoramaImage }}
                      style={styles.feedbackPhoto}
                      resizeMode="cover"
                    />
                  </View>
                )}
                
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => {
                    setModalVisible(false);
                    setSelectedFeedback(null);
                  }}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Admin Panel Modal */}
      <Modal
        visible={modalVisible && isAdmin}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.adminModalContainer}>
          <View style={styles.adminModalContent}>
            <Text style={styles.adminModalTitle}>Pending Feedback</Text>
            <ScrollView>
              {pendingFeedback.map((feedback) => (
                <View key={feedback.id} style={styles.feedbackItem}>
                  <Text style={styles.feedbackType}>
                    {getAccessibilityTypeLabel(feedback.type)}
                  </Text>
                  <Text>Features: {feedback.features.join(', ')}</Text>
                  <Text>Comment: {feedback.comment}</Text>
                  <View style={styles.adminActions}>
                    <TouchableOpacity
                      style={styles.approveButton}
                      onPress={() => handleApproveFeedback(feedback.id)}
                    >
                      <Text style={styles.actionButtonText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.rejectButton}
                      onPress={() => handleRejectFeedback(feedback.id)}
                    >
                      <Text style={styles.actionButtonText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4285F4" />
        </View>
      )}

      <NotificationListener />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  map: {
    flex: 1,
  },
  legendContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  legendTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 8,
  },
  legendItems: {
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: '#424242',
  },
  filterContainer: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  filterScrollContent: {
    gap: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E3F2FD',
    minWidth: 100,
  },
  activeFilter: {
    backgroundColor: '#2196F3',
    borderColor: '#1976D2',
  },
  filterText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1976D2',
    marginLeft: 6,
  },
  activeFilterText: {
    color: 'white',
  },
  addButton: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    backgroundColor: '#2196F3',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 8,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  bottomSheetIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    position: 'absolute',
    top: -30,
    alignSelf: 'center',
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212121',
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    padding: 8,
  },
  typeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 6,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  accessibleButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#388E3C',
  },
  partiallyButton: {
    backgroundColor: '#FFC107',
    borderColor: '#FFA000',
  },
  inaccessibleButton: {
    backgroundColor: '#F44336',
    borderColor: '#D32F2F',
  },
  typeButtonText: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  activeTypeText: {
    color: 'white',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 12,
    marginTop: 16,
  },
  requiredText: {
    color: '#F44336',
    fontSize: 16,
  },
  featureButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  featureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  selectedFeature: {
    backgroundColor: '#2196F3',
    borderColor: '#1976D2',
  },
  featureButtonText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#424242',
    fontWeight: '500',
  },
  selectedFeatureText: {
    color: 'white',
  },
  commentInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    height: 80,
    textAlignVertical: 'top',
    marginBottom: 15,
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#ccc',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 10,
  },
  submitButton: {
    flex: 1,
    backgroundColor: '#4285F4',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#a0a0a0',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  // Modal styles
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 15,
    overflow: 'hidden',
    elevation: 5,
  },
  modalHeader: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  modalTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  featuresContainer: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  commentContainer: {
    padding: 15,
  },
  commentText: {
    lineHeight: 20,
  },
  closeButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  imagePreviewContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 15,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  takePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    marginBottom: 15,
  },
  takePhotoText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#2196F3',
    fontWeight: '500',
  },
  retakeButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 20,
  },
  retakeButtonText: {
    color: 'white',
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '500',
  },
  adminButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: '#FF5722',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 25,
    elevation: 5,
  },
  adminButtonText: {
    color: 'white',
    marginLeft: 8,
    fontWeight: '600',
  },
  adminModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  adminModalContent: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    maxHeight: '80%',
  },
  adminModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  feedbackItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 10,
  },
  feedbackType: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
  },
  adminActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 10,
  },
  approveButton: {
    backgroundColor: '#4CAF50',
    padding: 8,
    borderRadius: 5,
    minWidth: 80,
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: '#F44336',
    padding: 8,
    borderRadius: 5,
    minWidth: 80,
    alignItems: 'center',
  },
  actionButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  closeModalButton: {
    marginTop: 15,
    backgroundColor: '#757575',
    padding: 12,
    borderRadius: 5,
    alignItems: 'center',
  },
  closeModalText: {
    color: 'white',
    fontWeight: '600',
  },
  photoContainer: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  feedbackPhoto: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: 20,
  },
  errorText: {
    color: '#F44336',
    fontSize: 16,
    textAlign: 'center',
    marginVertical: 20,
    lineHeight: 24,
  },
  errorButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  retryButton: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  settingsButton: {
    backgroundColor: '#4CAF50',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});

export default AccessibilityMap;
