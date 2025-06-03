import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Modal, Alert, ActivityIndicator, Image, Platform, Animated, Easing } from 'react-native';
import MapView, { Circle, Heatmap, PROVIDER_DEFAULT, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../../context/authContext';
import { collection, addDoc, getDocs, query, where, getDoc, doc, updateDoc, deleteDoc, limit, onSnapshot, select, setDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useFocusEffect } from '@react-navigation/native';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Gyroscope } from 'expo-sensors';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

// Check for environment configuration
const ENV = process.env.APP_ENV || Constants.expoConfig?.extra?.appEnvironment || 'development';
const GEMINI_TIMEOUT_MS = process.env.GEMINI_TIMEOUT_MS ? 
  parseInt(process.env.GEMINI_TIMEOUT_MS, 10) : 30000; // Default 30 seconds
const USE_LOW_QUALITY_IMAGES = process.env.IMAGE_QUALITY === 'low' || Platform.OS === 'android';
const IS_TESTING = ENV === 'testing' || process.env.GEMINI_DEBUG === 'true';

// Add debug logging function
const debugLog = (message, ...args) => {
  if (IS_TESTING) {
    console.log(`[GEMINI-DEBUG] ${message}`, ...args);
  }
};

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Gemini API configuration
// Try to get API key from Constants.expoConfig.extra first, fall back to hardcoded key if not available
const GEMINI_API_KEY = Constants.expoConfig?.extra?.geminiApiKey || 'AIzaSyB39VU33DtO7f9ZxmEtySX_5lgZT3Ary0k';
console.log('Using Gemini API key from:', Constants.expoConfig?.extra?.geminiApiKey ? 'app.json' : 'hardcoded value');

// Add direct Gemini API endpoint
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
console.log('Environment:', ENV, 'Using direct API calls to Gemini');

// Log environment settings for debug builds
if (IS_TESTING) {
  debugLog('Environment:', ENV);
  debugLog('Platform:', Platform.OS);
  debugLog('Gemini Timeout:', GEMINI_TIMEOUT_MS, 'ms');
  debugLog('Using low quality images:', USE_LOW_QUALITY_IMAGES ? 'YES' : 'NO');
}

// Add these new constants at the top of the file after imports
const INDOOR_RADIUS = 20; // meters
const FLOOR_HEIGHT = 3; // meters per floor
const MAX_INDOOR_DISTANCE = 50; // meters

const BottomSheetHeader = ({ title, onClose, onHelp }) => (
  <View style={styles.bottomSheetHeader}>
    <View style={styles.bottomSheetIndicator} />
    <Text style={styles.bottomSheetTitle}>{title}</Text>
    {onHelp && (
      <TouchableOpacity style={styles.helpButton} onPress={onHelp}>
        <Ionicons name="help-circle" size={24} color="#2196F3" />
      </TouchableOpacity>
    )}
    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
      <Ionicons name="close" size={24} color="#9E9E9E" />
    </TouchableOpacity>
  </View>
);

const Legend = () => (
  <View style={styles.legendContainer}>
    <View style={styles.legendHeader}>
      <Ionicons name="options-outline" size={16} color="#555" />
      <Text style={styles.legendTitle}>Features</Text>
    </View>
    <View style={styles.legendItems}>
      <View style={styles.legendItem}>
        <View style={styles.legendIconWrapper}>
          <Ionicons name="accessibility-outline" size={14} color="rgba(76, 175, 80, 0.85)" />
        </View>
        <Text style={styles.legendText}>Ramps</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendIconWrapper}>
          <Ionicons name="arrow-up-outline" size={14} color="rgba(33, 150, 243, 0.85)" />
        </View>
        <Text style={styles.legendText}>Elevators</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendIconWrapper}>
          <Ionicons name="resize-outline" size={14} color="rgba(255, 152, 0, 0.85)" />
        </View>
        <Text style={styles.legendText}>Wide Paths</Text>
      </View>
                <View style={styles.legendItem}>
            <View style={styles.legendIconWrapper}>
              <Ionicons name="water-outline" size={14} color="rgba(156, 39, 176, 0.85)" />
            </View>
            <Text style={styles.legendText}>PWD Restrooms</Text>
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

// Add this new component after the imports and before the AccessibilityMap component
const AnalyzingAnimation = ({ visible, isPhotoAnalysis = false }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [messageIndex, setMessageIndex] = useState(0);
  
  // Simplified messages for a cleaner look
  const generalMessages = [
    "Analyzing accessibility features...",
    "Detecting accessibility elements...",
    "Almost done..."
  ];
  
  const photoAnalysisMessages = [
    "Processing image...",
    "Analyzing features...",
    "Detecting ramps & pathways...",
    "Identifying elevators...",
    "Almost complete..."
  ];
  
  const messages = isPhotoAnalysis ? photoAnalysisMessages : generalMessages;

  useEffect(() => {
    if (visible) {
      // Reset animations when becoming visible
      pulseAnim.setValue(1);
      rotateAnim.setValue(0);
      progressAnim.setValue(0);
      fadeAnim.setValue(0);
      
      // Fade in animation
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.ease,
        useNativeDriver: true,
      }).start();
      
      // Subtle pulsing animation
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      
      // Smooth rotating animation
      const rotateAnimation = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: isPhotoAnalysis ? 3000 : 4000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      
      // Progress bar animation
      const progressAnimation = Animated.timing(progressAnim, {
        toValue: 1,
        duration: isPhotoAnalysis ? 12000 : 6000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      });
      
      pulseAnimation.start();
      rotateAnimation.start();
      progressAnimation.start();

      // Rotate through messages
      const messageInterval = setInterval(() => {
        setMessageIndex((prev) => (prev + 1) % messages.length);
      }, 2200);

      return () => {
        clearInterval(messageInterval);
        pulseAnimation.stop();
        rotateAnimation.stop();
        progressAnimation.stop();
        
        // Fade out on cleanup
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();
      };
    }
  }, [visible, isPhotoAnalysis]);

  if (!visible) return null;
  
  // Create a rotation interpolation for the spinner
  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  return (
    <Animated.View style={[
      styles.analyzingContainer,
      { opacity: fadeAnim }
    ]}>
      <View style={[
        styles.analyzingContent,
        isPhotoAnalysis && styles.photoAnalyzingContent
      ]}>
        {/* Icon container with clean shadow */}
        <Animated.View
          style={[
            isPhotoAnalysis ? styles.photoAnalyzingIconContainer : styles.analyzingIconContainer,
            {
              transform: [
                { scale: pulseAnim },
                { rotate: spin }
              ],
              shadowOpacity: isPhotoAnalysis ? 0.2 : 0.12,
            },
          ]}
        >
          {isPhotoAnalysis ? (
            <Ionicons name="camera" size={28} color="#FFFFFF" />
          ) : (
            <Ionicons name="scan-outline" size={28} color="#2196F3" />
          )}
        </Animated.View>
        
        {/* Clean message display */}
        <Animated.Text 
          style={[
            styles.analyzingText,
            isPhotoAnalysis && styles.photoAnalyzingText
          ]}
        >
          {messages[messageIndex]}
        </Animated.Text>
        
        {/* Modern progress bar */}
        <View style={styles.progressBarContainer}>
          <Animated.View 
            style={[
              styles.progressBar,
              isPhotoAnalysis ? styles.photoProgressBar : {},
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['5%', '100%']
                })
              }
            ]} 
          />
        </View>
      </View>
    </Animated.View>
  );
};

const AccessibilityMap = () => {
  // State management
  const [location, setLocation] = useState(null);
  const [feedbacks, setFeedbacks] = useState([]);
  const [addingFeedback, setAddingFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState(null);
  const [comment, setComment] = useState('');
  const [selectedFilters, setSelectedFilters] = useState({
    wheelchairRamps: true,
    elevators: true,
    chairs: true,
    widePathways: true,
    pwdRestrooms: true,
  });
  const [activeFilters, setActiveFilters] = useState([]);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedbackData, setFeedbackData] = useState({});
  const [panoramaImage, setPanoramaImage] = useState(null);
  const { user } = useAuth();
  const [zoomLevel, setZoomLevel] = useState(15);
  const [showAllPointsModal, setShowAllPointsModal] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [helpModalVisible, setHelpModalVisible] = useState(false);
  const [accessibilityFilters, setAccessibilityFilters] = useState({
    accessible: true,
    partially: true,
    inaccessible: true
  });
  // Add new state for API verification
  const [geminiApiVerified, setGeminiApiVerified] = useState(false);
  const [apiVerificationAttempted, setApiVerificationAttempted] = useState(false);

  // Add the missing ref
  const locationWatchRef = useRef(null);
  const isMounted = useRef(true);

  // Add new state for feedback validation
  const [feedbackValidation, setFeedbackValidation] = useState({
    isValid: false,
    confidence: 0,
    reasons: []
  });

  // Add these new state variables for collapsible filters
  const [filtersCollapsed, setFiltersCollapsed] = useState(true); // Start collapsed
  const filterContainerHeight = useRef(new Animated.Value(0)).current; // Start with 0 height

  // Add new state for submission lock
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add this new function to verify Gemini API connectivity
  const verifyGeminiApiConnectivity = async () => {
    if (apiVerificationAttempted) return;
    
    try {
      console.log('🔄 Verifying Gemini API connectivity...');
      
      // Mark as attempted - but we'll set verified based on success
      setApiVerificationAttempted(true);
      
      // Use direct axios call for API verification - more reliable
      const response = await axios({
        method: 'post',
        url: GEMINI_URL,
        headers: {
          'Content-Type': 'application/json'
        },
        data: {
          contents: [{
            parts: [{ text: "Respond with just the word 'connected'" }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 10
          }
        },
        timeout: 10000
      });
      
      console.log('✅ Gemini API connectivity verified successfully!');
      
      // Successfully got a response, so we can mark as verified
      setGeminiApiVerified(true);
    } catch (error) {
      console.error('❌ Gemini API connectivity verification failed:', error.message);
      
      // Try alternative verification method using models endpoint
      try {
        console.log('🔄 Trying alternative API verification...');
        const modelsResponse = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
          { timeout: 5000 }
        );
        
        if (modelsResponse.status === 200) {
          console.log('✅ Alternative API verification successful!');
          setGeminiApiVerified(true);
          return;
        }
      } catch (altError) {
        console.error('❌ Alternative verification also failed:', altError.message);
      }
      
      // Show more detailed error message
      Alert.alert(
        "API Connection Issue",
        `There might be issues connecting to our image recognition service. Photos may not be properly analyzed.\n\n` +
        `Technical details:\n` +
        `• Environment: ${ENV}\n` +
        `• API Key: ${GEMINI_API_KEY ? 'Available' : 'Missing'}\n` +
        `• Error: ${error.message}\n\n` +
        `Please check your internet connection or try again later.`,
        [
          { 
            text: "Retry Connection", 
            onPress: () => {
              setApiVerificationAttempted(false);
              setTimeout(() => verifyGeminiApiConnectivity(), 1000);
            } 
          },
          { text: "Continue Anyway" }
        ]
      );
    }
  };

  // Add API verification check on component mount
  useEffect(() => {
    // For development environment, we'll skip the verification or force success
    if (ENV === 'development') {
      console.log('🛠️ Development environment detected - forcing API verification success');
      setApiVerificationAttempted(true);
      setGeminiApiVerified(true);
    } else {
      // For production, do the actual verification
      verifyGeminiApiConnectivity();
    }
  }, []);

  // Add function to toggle accessibility filters
  const toggleAccessibilityFilter = (type) => {
    setAccessibilityFilters(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  // Add function to toggle filters visibility
  const toggleFiltersCollapsed = () => {
    const toValue = filtersCollapsed ? 1 : 0;
    Animated.timing(filterContainerHeight, {
      toValue,
      duration: 300,
      useNativeDriver: false,
      easing: Easing.inOut(Easing.ease)
    }).start();
    setFiltersCollapsed(!filtersCollapsed);
  };

  // Define the AccessibilityTypeFilter component
  const AccessibilityTypeFilter = () => (
    <Animated.View 
      style={[
        styles.accessibilityFilterContainer,
        {
          height: filterContainerHeight.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 220]
          }),
          opacity: filterContainerHeight,
          overflow: 'hidden',
          marginTop: 8
        }
      ]}
    >
      <Text style={styles.filterTitle}>Filter Features</Text>
      <ScrollView style={{flex: 1}} contentContainerStyle={styles.accessibilityFilterButtons}>
        <TouchableOpacity
          style={[
            styles.accessibilityFilterButton,
            selectedFilters.wheelchairRamps && styles.activeAccessibilityFilter
          ]}
          onPress={() => toggleAddFilter('wheelchairRamps')}
        >
          <View style={styles.filterIconContainer}>
                          <Ionicons 
              name="accessibility-outline" 
              size={16} 
              color={selectedFilters.wheelchairRamps 
                ? "rgba(76, 175, 80, 0.9)" 
                : "rgba(117, 117, 117, 0.7)"} 
            />
          </View>
          <Text style={[
            styles.filterButtonText,
            selectedFilters.wheelchairRamps && styles.activeFilterText
          ]}>Ramps</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.accessibilityFilterButton,
            selectedFilters.elevators && styles.activeAccessibilityFilter
          ]}
          onPress={() => toggleAddFilter('elevators')}
        >
          <View style={styles.filterIconContainer}>
                          <Ionicons 
              name="arrow-up-outline" 
              size={16} 
              color={selectedFilters.elevators 
                ? "rgba(33, 150, 243, 0.9)" 
                : "rgba(117, 117, 117, 0.7)"} 
            />
          </View>
          <Text style={[
            styles.filterButtonText,
            selectedFilters.elevators && styles.activeFilterText
          ]}>Elevators</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.accessibilityFilterButton,
            selectedFilters.widePathways && styles.activeAccessibilityFilter
          ]}
          onPress={() => toggleAddFilter('widePathways')}
        >
          <View style={styles.filterIconContainer}>
                          <Ionicons 
              name="resize-outline" 
              size={16} 
              color={selectedFilters.widePathways 
                ? "rgba(255, 152, 0, 0.9)" 
                : "rgba(117, 117, 117, 0.7)"} 
            />
          </View>
          <Text style={[
            styles.filterButtonText,
            selectedFilters.widePathways && styles.activeFilterText
          ]}>Pathways</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.accessibilityFilterButton,
            selectedFilters.pwdRestrooms && styles.activeAccessibilityFilter
          ]}
          onPress={() => toggleAddFilter('pwdRestrooms')}
        >
          <View style={styles.filterIconContainer}>
                          <Ionicons 
              name="water-outline" 
              size={16} 
              color={selectedFilters.pwdRestrooms 
                ? "rgba(156, 39, 176, 0.9)" 
                : "rgba(117, 117, 117, 0.7)"} 
            />
          </View>
          <Text style={[
            styles.filterButtonText,
            selectedFilters.pwdRestrooms && styles.activeFilterText
          ]}>PWD Restrooms</Text>
                  </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    );

  // Replace FilterToggleButton component
  const FilterToggleButton = () => (
    <TouchableOpacity
      style={styles.filterToggleButton}
      onPress={toggleFiltersCollapsed}
    >
      <Ionicons 
        name={filtersCollapsed ? "funnel" : "funnel-outline"} 
        size={16} 
        color="white" 
      />
      <Text style={styles.filterToggleText}>
        {filtersCollapsed ? "Filter" : "Hide"}
      </Text>
    </TouchableOpacity>
  );

  // Initialize location and permissions with improved error handling
  useEffect(() => {
    const initializeLocation = async () => {
      try {
        console.log('Starting location initialization...');
        
        // Check if we already have permission status stored
        const storedPermissions = await AsyncStorage.getItem('permissionsStatus');
        let hasLocationPermission = false;
        
        if (storedPermissions) {
          const parsedPermissions = JSON.parse(storedPermissions);
          hasLocationPermission = parsedPermissions.location === true;
        }
        
        // Only request permission if we don't already have it
        if (!hasLocationPermission) {
          console.log('Requesting location permission...');
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            console.log('Location permission denied');
            setMapError('Location permission not granted. Please enable location permissions in your device settings.');
            return;
          }
          
          // Update stored permissions
          const updatedPermissions = storedPermissions ? 
            {...JSON.parse(storedPermissions), location: true} :
            {location: true};
          await AsyncStorage.setItem('permissionsStatus', JSON.stringify(updatedPermissions));
        }
        
        // Check if location services are enabled
        try {
          const locationEnabled = await Location.hasServicesEnabledAsync();
          console.log('Location services enabled:', locationEnabled);
          
          if (!locationEnabled) {
            setMapError('Location services are disabled. Please enable location services in your device settings.');
            return;
          }
        } catch (serviceError) {
          console.warn('Error checking location services:', serviceError);
          // Continue anyway since services might actually be enabled
          // The hasServicesEnabledAsync API can be unreliable on some devices
        }

        // Try to get location with multiple attempts if needed
        console.log('Getting current position...');
        let currentLocation;
        
        try {
          // First try with high accuracy but short timeout
          currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            timeout: 5000
          });
        } catch (highAccuracyError) {
          console.warn('High accuracy location failed, trying low accuracy:', highAccuracyError);
          
          try {
            // Fall back to low accuracy with longer timeout
            currentLocation = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
              timeout: 10000
            });
          } catch (lowAccuracyError) {
            console.error('Low accuracy location also failed:', lowAccuracyError);
            throw new Error('Could not get location after multiple attempts');
          }
        }

        if (!currentLocation) {
          throw new Error('Location is null after attempts');
        }

        console.log('Location obtained successfully');
        
        if (isMounted.current) {
          setLocation({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          });
        }

        // Start watching location changes
        console.log('Starting location watch...');
        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (location) => {
            if (isMounted.current) {
              setLocation(prev => ({
                ...prev,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }));
            }
          }
        );
        
        console.log('Location initialization complete');
      } catch (error) {
        console.error('Error initializing location:', error);
        
        // More specific error messages
        if (error.message && error.message.toLowerCase().includes('location is unavailable')) {
          setMapError('Location services may be disabled. Please verify your device location settings are enabled and try again.');
        } else if (error.message && error.message.toLowerCase().includes('timeout')) {
          setMapError('Location request timed out. Please check if you have a GPS signal and try again.');
        } else if (error.message && error.message.toLowerCase().includes('denied')) {
          setMapError('Location permission denied. Please enable location permissions for this app in your device settings.');
        } else {
          setMapError(`${error.message || 'Failed to initialize location'}. Please check your device settings and try again.`);
        }
      }
    };

    initializeLocation();

    return () => {
      isMounted.current = false;
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
      }
    };
  }, []);

  // Improved function to retry location initialization with better error handling
  const retryLocationInitialization = async () => {
    setMapError(null);
    setLoading(true);
    
    try {
      console.log('Retrying location initialization...');
      
      // First try to verify if location services are enabled by using a different approach
      // This method is more reliable on some devices
      try {
        // On Android, we can use the Expo Location.enableNetworkProviderAsync() as a test
        if (Platform.OS === 'android') {
          await Location.enableNetworkProviderAsync()
            .then(() => console.log('Network provider enabled'))
            .catch(e => console.log('Network provider status:', e));
        }
      } catch (providerError) {
        // This is just diagnostic, we continue anyway
        console.log('Provider test error:', providerError);
      }

      // Request permissions again to be sure
      console.log('Requesting location permissions again...');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Permission denied on retry');
        setMapError('Location permission not granted. Please enable location permissions in your device settings.');
        return;
      }
      
      // Try multiple location methods
      console.log('Trying to get location on retry...');
      let currentLocation;
      
      try {
        // Try Last Known location first (fast)
        console.log('Trying getLastKnownPositionAsync...');
        currentLocation = await Location.getLastKnownPositionAsync();
        
        if (!currentLocation) {
          // Then try current position with lower accuracy first
          console.log('Last known position unavailable, trying low accuracy...');
          currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
            timeout: 5000
          });
        }
      } catch (firstAttemptError) {
        console.warn('First location attempt failed:', firstAttemptError);
        
        // Final attempt with high accuracy and longer timeout
        try {
          console.log('Trying balanced accuracy with longer timeout...');
          currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            timeout: 15000
          });
        } catch (finalAttemptError) {
          console.error('Final location attempt failed:', finalAttemptError);
          throw new Error('Could not get your location after multiple attempts. Please check your GPS signal and location settings.');
        }
      }

      if (!currentLocation) {
        throw new Error('Location is still unavailable. Please try again later.');
      }

      console.log('Successfully got location on retry!');
      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
      
      // Restart location watch
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
      }
      
      locationWatchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (location) => {
          if (isMounted.current) {
            setLocation(prev => ({
              ...prev,
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            }));
          }
        }
      );
      
    } catch (error) {
      console.error('Error retrying location initialization:', error);
      
      // More specific error messages
      if (error.message && error.message.toLowerCase().includes('location is unavailable')) {
        setMapError('Your device reports that location services are unavailable. Please verify your location settings are enabled and try again.');
      } else if (error.message && error.message.toLowerCase().includes('timeout')) {
        setMapError('Location request timed out. Please check if you have a GPS signal and try again in an area with better reception.');
      } else {
        setMapError(error.message || 'Failed to get location. Please check your device settings and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Initialize camera permissions
  useEffect(() => {
    const initializeCamera = async () => {
      try {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          setMapError('Camera permission not granted');
        }
      } catch (error) {
        console.error('Error requesting camera permission:', error);
      }
    };

    initializeCamera();
  }, []);

  // Optimize data fetching with cleanup and caching
  useFocusEffect(
    React.useCallback(() => {
      let abortController = new AbortController();
      const lastFetchTime = AsyncStorage.getItem('lastFeedbackFetch');

      const refreshData = async () => {
        if (!isMounted.current) return;
        
        try {
          // Only fetch if data is older than 5 minutes or doesn't exist
          const currentTime = Date.now();
          const lastFetch = await lastFetchTime;
          
          if (!lastFetch || (currentTime - parseInt(lastFetch)) > 300000) {
            await fetchInitialFeedback();
            await AsyncStorage.setItem('lastFeedbackFetch', currentTime.toString());
          }
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.error('Error refreshing data:', error);
          }
        }
      };
      
      refreshData();

      return () => {
        abortController.abort();
      };
    }, [])
  );

  // Optimize admin status check
  useEffect(() => {
    let mounted = true;

    const checkAdminStatus = async () => {
      if (!user || !mounted) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (mounted) {
          // No admin-related code needed here
        }
      } catch (error) {
        console.error('Error checking admin status:', error);
      }
    };

    checkAdminStatus();

    return () => {
      mounted = false;
    };
  }, [user]);

  // Optimize notification registration
  useEffect(() => {
    const registerForPushNotifications = async () => {
      if (!isMounted.current) return;
      
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        
        if (finalStatus !== 'granted' || !isMounted.current) {
          return;
        }

        const token = await Notifications.getExpoPushTokenAsync({
          projectId: "c8cb54d9-e7a3-4dd2-a327-013a9656fb34"
        });

        if (user && isMounted.current) {
          // Store token in user's document
          await updateDoc(doc(db, 'users', user.uid), {
            expoPushToken: token.data,
            tokenUpdatedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error registering for push notifications:', error);
      }
    };

    registerForPushNotifications();
  }, [user]);

  // Add this new function to calculate indoor distance
  const calculateIndoorDistance = (point1, point2, floor1, floor2) => {
    // Calculate horizontal distance
    const horizontalDistance = calculateDistance(point1, point2);
    
    // Calculate vertical distance if floors are different
    const verticalDistance = floor1 && floor2 ? 
      Math.abs(floor1 - floor2) * FLOOR_HEIGHT : 0;
    
    // Return the total distance
    return Math.sqrt(Math.pow(horizontalDistance, 2) + Math.pow(verticalDistance, 2));
  };

  // Update the createHeatmapPoint function
  const createHeatmapPoint = (coordinate, type, floor = null) => ({
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    weight: type === 'accessible' ? 1.0 : type === 'partially' ? 0.5 : 0.2,
    intensity: 1.0,
    floor: floor,
    radius: INDOOR_RADIUS
  });

  // Update the fetchInitialFeedback function
  const fetchInitialFeedback = async () => {
    try {
      setLoading(true);
      
      const feedbackRef = collection(db, 'accessibility_feedback');
      const q = query(
        feedbackRef, 
        where('status', '==', 'approved')
      );
      
      const querySnapshot = await getDocs(q);
      
      const fetchedFeedback = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      if (isMounted.current) {
        console.log('Fetched feedback count:', fetchedFeedback.length);
        setFeedbacks(fetchedFeedback);
        
        // Create heatmap points for each type
        const heatmapPoints = {
          accessible: [],
          partially: [],
          inaccessible: []
        };

        fetchedFeedback.forEach(data => {
          if (data.coordinate && data.type) {
            const point = createHeatmapPoint(
              data.coordinate,
              data.type,
              data.floor || null
            );
            
            heatmapPoints[data.type].push(point);
          }
        });

        console.log('Points by type:', {
          accessible: heatmapPoints.accessible.length,
          partially: heatmapPoints.partially.length,
          inaccessible: heatmapPoints.inaccessible.length
        });

        // We don't need heatmap data anymore, but we'll keep the points data for reference
        setFeedbackData(heatmapPoints);

        // Notify user that map data has been updated
        if (heatmapPoints.accessible.length > 0 || 
            heatmapPoints.partially.length > 0 || 
            heatmapPoints.inaccessible.length > 0) {
          
          const totalPoints = heatmapPoints.accessible.length + 
                             heatmapPoints.partially.length + 
                             heatmapPoints.inaccessible.length;
          
          // Only show notification if we have points and not initial load
          if (totalPoints > 0 && !isMounted.current) {
            showLocalNotification(
              'Accessibility Map Updated',
              `Map refreshed with ${totalPoints} accessibility points`
            );
          }
        }
      }
    } catch (error) {
      console.error("Error fetching feedback:", error);
      Alert.alert("Error", "Failed to load accessibility data");
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  // Add useEffect to fetch data when component mounts
  useEffect(() => {
    fetchInitialFeedback();
  }, []);

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

  // Enhanced image analysis function with direct Gemini Vision API calls using axios
  const analyzeImage = async (uri) => {
    // Add timeout promise to prevent hanging
    const timeoutPromise = (ms) => new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Analysis timed out')), ms)
    );

    try {
      console.log('📸 Starting image analysis with Gemini Vision API...');
      console.log(`Image URI: ${uri.substring(0, 30)}...`);
      
      // Show loading state immediately
      setLoading(true);
      
      // Prepare and optimize image
      console.log('🔄 Preparing image for analysis...');
      
      // Set image parameters based on environment and platform
      const imageWidth = USE_LOW_QUALITY_IMAGES ? 400 : 500; 
      const imageQuality = USE_LOW_QUALITY_IMAGES ? 0.4 : 0.5;
      
      console.log(`Using width: ${imageWidth}, quality: ${imageQuality}`);
      
      // Optimize image first
      const optimizedImage = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: imageWidth } }],
        { compress: imageQuality, format: ImageManipulator.SaveFormat.JPEG }
      );
      
      // Convert to base64
      const base64 = await FileSystem.readAsStringAsync(optimizedImage.uri, 
        { encoding: FileSystem.EncodingType.Base64 });
      
      console.log(`Image prepared, size: ${base64.length} characters`);
      
      // If image is still too large, compress further
      let finalBase64 = base64;
      if (base64.length > 3000000) {
        console.log('Image too large, reducing further...');
        
        const smallerImage = await ImageManipulator.manipulateAsync(
          optimizedImage.uri,
          [{ resize: { width: Platform.OS === 'android' ? 300 : 350 } }],
          { compress: 0.3, format: ImageManipulator.SaveFormat.JPEG }
        );
        
        finalBase64 = await FileSystem.readAsStringAsync(smallerImage.uri, 
          { encoding: FileSystem.EncodingType.Base64 });
        
        console.log(`Reduced image size: ${finalBase64.length} characters`);
      }
      
      // Prepare payload for Gemini API
      const payload = {
        contents: [
          {
            parts: [
              { text: analysisPromptText },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: finalBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: ENV === 'development' ? 1024 : 768
        }
      };
      
      console.log('Sending request to Gemini API...');
      
      // Use axios with Promise.race for timeout
      const response = await Promise.race([
        axios({
          method: 'post',
          url: GEMINI_URL,
          headers: {
            'Content-Type': 'application/json',
          },
          data: payload,
          timeout: GEMINI_TIMEOUT_MS
        }),
        timeoutPromise(GEMINI_TIMEOUT_MS + 5000) // Add 5s buffer to the axios timeout
      ]);
      
      console.log('✅ Received response from Gemini API');
      
      // Extract the text response
      const textResponse = response.data.candidates[0]?.content?.parts?.[0]?.text || '';
      console.log('Raw response:', textResponse.substring(0, 200) + '...');
      
      // Try to parse JSON from response
      try {
        // Find JSON in the response
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : "{}";
        
        const analysisResult = JSON.parse(jsonStr);
        console.log('Successfully parsed JSON response');
        
        // Process the results into our expected format
        const formattedResult = {
          wheelchairRamps: analysisResult.wheelchairRamps || { detected: false, confidence: 0, characteristics: [] },
          elevators: analysisResult.elevators || { detected: false, confidence: 0, characteristics: [] },
          widePathways: analysisResult.widePathways || { detected: false, confidence: 0, characteristics: [] },
          pwdRestrooms: analysisResult.pwdRestrooms || { detected: false, confidence: 0, characteristics: [] }
        };
        
        return formattedResult;
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        
        // If JSON parsing fails, use our custom function to extract insights
        console.log("⚠️ Falling back to structured parsing of text response");
        try {
          const tags = deriveTagsFromText(textResponse);
          const features = detectFeaturesWithConfidence(tags);
          return features;
        } catch (fallbackError) {
          console.error('❌ Fallback parsing failed:', fallbackError);
          // Return default results if all parsing fails
          return {
            wheelchairRamps: { detected: false, confidence: 0, characteristics: [] },
            elevators: { detected: false, confidence: 0, characteristics: [] },
            widePathways: { detected: false, confidence: 0, characteristics: [] },
            pwdRestrooms: { detected: false, confidence: 0, characteristics: [] }
          };
        }
      }
    } catch (error) {
      console.error('❌ Image analysis error:', error);
      
      // Check for specific axios errors
      if (error.response) {
        // The request was made and the server responded with an error
        console.error('API Error:', error.response.status, error.response.data);
      } else if (error.request) {
        // The request was made but no response was received
        console.error('Network Error: No response received');
      } else {
        // Something happened in setting up the request
        console.error('Request setup error:', error.message);
      }
      
      return {
        wheelchairRamps: { detected: false, confidence: 0, characteristics: [] },
        elevators: { detected: false, confidence: 0, characteristics: [] },
        widePathways: { detected: false, confidence: 0, characteristics: [] },
        pwdRestrooms: { detected: false, confidence: 0, characteristics: [] }
      };
    } finally {
      // Always ensure loading state is reset
      setLoading(false);
    }
  };

  // Log API request status and environment for diagnostics
  useEffect(() => {
    if (ENV !== 'development') {
      console.log('=== GEMINI API CONFIG ===');
      console.log('Environment:', ENV);
      console.log('API Key available:', GEMINI_API_KEY ? 'Yes (length: ' + GEMINI_API_KEY.length + ')' : 'NO!');
      console.log('Timeout:', GEMINI_TIMEOUT_MS, 'ms');
      console.log('Image Quality:', USE_LOW_QUALITY_IMAGES ? 'Low' : 'High');
      
      // Test basic connectivity to Google APIs
      setTimeout(() => {
        fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + GEMINI_API_KEY)
          .then(res => {
            if (res.ok) {
              console.log('✅ API connectivity test successful');
              return res.json();
            } else {
              throw new Error(`Status: ${res.status}`);
            }
          })
          .then(data => console.log('Models available:', (data.models || []).length))
          .catch(err => console.error('❌ API connectivity test failed:', err));
      }, 2000);
    }
  }, []);

  // Helper function to derive tags from text response if JSON parsing fails
  const deriveTagsFromText = (text) => {
    const tags = [];
    
    // Map of keywords to look for and their categories
    const keywordMap = {
      'ramp': { name: 'ramp', category: 'wheelchairRamps', confidence: 0.8 },
      'wheelchair': { name: 'wheelchair', category: 'wheelchairRamps', confidence: 0.8 },
      'slope': { name: 'slope', category: 'wheelchairRamps', confidence: 0.7 },
      'elevator': { name: 'elevator', category: 'elevators', confidence: 0.8 },
      'lift': { name: 'lift', category: 'elevators', confidence: 0.8 },
      'wide path': { name: 'wide path', category: 'widePathways', confidence: 0.8 },
      'corridor': { name: 'corridor', category: 'widePathways', confidence: 0.7 },
      'hallway': { name: 'hallway', category: 'widePathways', confidence: 0.7 },
      'restroom': { name: 'restroom', category: 'pwdRestrooms', confidence: 0.8 },
      'bathroom': { name: 'bathroom', category: 'pwdRestrooms', confidence: 0.8 },
      'toilet': { name: 'toilet', category: 'pwdRestrooms', confidence: 0.7 }
    };
    
    // Find mentions of keywords in the text
    Object.entries(keywordMap).forEach(([keyword, info]) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(text)) {
        // Look for confidence scores
        const confidenceMatch = text.match(new RegExp(`\\b${keyword}\\b.{0,50}?(\\d+\\.\\d+|\\d+)%?\\s*(confidence|probability|likelihood)`, 'i'));
        const confidence = confidenceMatch ? 
          parseFloat(confidenceMatch[1]) / (confidenceMatch[0].includes('%') ? 100 : 1) : 
          info.confidence;
        
        tags.push({
          name: info.name,
          confidence: Math.min(confidence, 1.0), // Ensure confidence is not greater than 1
          characteristics: [info.category]
        });
      }
    });
    
    return tags;
  };

  // Helper function to derive feature characteristics based on tag
  const deriveCharacteristics = (tag) => {
    const characteristicsMap = {
      // Wheelchair ramp characteristics
      'ramp': ['inclined', 'accessible'],
      'slope': ['accessible', 'inclined'],
      'wheelchair': ['disability', 'accessible'],
      'accessibility': ['disability', 'accessible'],
      'disabled': ['disability', 'accessible'],
      
      // Elevator characteristics
      'elevator': ['vertical', 'transport'],
      'lift': ['vertical', 'transport'],
      'escalator': ['vertical', 'transport'],
      
      // Pathway characteristics
      'corridor': ['passage', 'wide'],
      'hallway': ['passage', 'indoor'],
      'pathway': ['passage', 'route'],
      'aisle': ['passage', 'indoor'],
      'road': ['passage', 'outdoor'],
      'lane': ['passage', 'outdoor'],
      
      // Restroom characteristics
      'toilet': ['facility', 'sanitary'],
      'restroom': ['facility', 'sanitary'],
      'bathroom': ['facility', 'sanitary'],
      'lavatory': ['facility', 'sanitary'],
      'washroom': ['facility', 'sanitary'],
      
      // PWD Restroom characteristics
      'wc': ['facility', 'sanitary'],
      'comfort room': ['facility', 'sanitary'],
      'pwd cr': ['facility', 'sanitary'],
      'pwd restroom': ['facility', 'sanitary'],
      'pwd bathroom': ['facility', 'sanitary'],
      
      // Additional keywords
      'logo': ['symbol', 'international symbol of access'],
      'symbol': ['international symbol of access'],
      'signage': ['international symbol of access'],
      'sign': ['international symbol of access'],
      'icon': ['international symbol of access'],
      'international symbol of access': ['international symbol of access']
    };
    
    return characteristicsMap[tag] || [];
  };

  // Enhanced feature detection with confidence scores
  const detectFeaturesWithConfidence = (tags) => {
    // Define tag groups for each feature with primary and secondary tags
    const featureTagGroups = {
      wheelchairRamps: {
        primary: ['ramp', 'wheelchair', 'accessibility', 'disabled', 'slope'],
        secondary: ['incline', 'access', 'handicap', 'mobility']
      },
      elevators: {
        primary: ['elevator', 'lift'],
        // Add more secondary terms to better catch elevator images
        secondary: ['escalator', 'vertical', 'transport', 'door', 'metal', 'button', 'floor', 'level', 
                    'steel', 'panel', 'building', 'hall', 'lobby', 'entrance', 'exit']
      },
      widePathways: {
        primary: ['corridor', 'hallway', 'pathway', 'aisle'],
        secondary: ['wide', 'spacious', 'passage', 'road', 'lane']
      },
      pwdRestrooms: {
        primary: ['pwd restroom', 'pwd bathroom', 'pwd cr', 'accessible restroom', 'accessible bathroom', 'handicap restroom', 'disabled restroom', 'wheelchair restroom'],
        secondary: ['pwd', 'wheelchair', 'handicap', 'disabled', 'accessibility', 'accessible', 'logo', 'symbol', 'signage', 'sign', 'icon', 'international symbol of access']
      }
    };

    // Calculate feature detection results with confidence
    const results = {};
    
    Object.entries(featureTagGroups).forEach(([feature, { primary, secondary }]) => {
      // Find matching tags
      const primaryMatches = tags.filter(tag => primary.includes(tag.name));
      const secondaryMatches = tags.filter(tag => secondary.includes(tag.name));
      
      // Calculate confidence based on matches
      let confidence = 0;
      let detected = false;
      let characteristics = [];
      
      // Primary matches have higher weight
      if (primaryMatches.length > 0) {
        const highestConfidence = Math.max(...primaryMatches.map(tag => tag.confidence));
        confidence = Math.min(0.95, highestConfidence * 1.5); // Boost confidence but cap at 0.95
        detected = true;
        
        // Collect characteristics from all primary matches
        characteristics = primaryMatches.flatMap(tag => tag.characteristics);
      } 
      // Secondary matches have lower weight but are still valuable
      else if (secondaryMatches.length > 0) {
        const highestConfidence = Math.max(...secondaryMatches.map(tag => tag.confidence));
        confidence = Math.min(0.7, highestConfidence * 0.9); // Higher boost for secondary matches
        detected = confidence > 0.3; // Lower threshold for detection
        
        // Collect characteristics from all secondary matches
        characteristics = secondaryMatches.flatMap(tag => tag.characteristics);
      }
      
      // For elevators specifically, check for multiple secondary matches to boost confidence
      if (feature === 'elevators' && secondaryMatches.length >= 3 && confidence > 0.2) {
        confidence = Math.min(0.8, confidence * 1.2); // Boost confidence for multiple matches
        detected = true;
      }
      
      // Store the results
      results[feature] = {
        detected,
        confidence,
        characteristics: [...new Set(characteristics)] // Remove duplicates
      };
    });
    
    console.log('Feature detection results:', JSON.stringify(results));
    return results;
  };

  // Accessibility level determination based on required features
  const determineAccessibility = (allAnalysisResults) => {
    console.log('🧠 Determining accessibility level based on analysis results...');
    
    const required = ['wheelchairRamps', 'elevators', 'widePathways', 'pwdRestrooms'];
    const presentFeaturesDetails = {
      wheelchairRamps: false,
      elevators: false,
      widePathways: false,
      pwdRestrooms: false
    };

    // First pass: Check for high confidence features (confidence > 0.7)
    let hasHighConfidenceFeature = false;
    allAnalysisResults.forEach(photoAnalysisResult => {
      required.forEach(featureName => {
        if (photoAnalysisResult[featureName]?.detected && 
            photoAnalysisResult[featureName].confidence > 0.7) {
          hasHighConfidenceFeature = true;
          presentFeaturesDetails[featureName] = true;
        }
      });
    });

    // Second pass: If no high confidence features, check for medium confidence (confidence > 0.25)
    if (!hasHighConfidenceFeature) {
      allAnalysisResults.forEach(photoAnalysisResult => {
        required.forEach(featureName => {
          if (photoAnalysisResult[featureName]?.detected && 
              photoAnalysisResult[featureName].confidence > 0.25) {
            presentFeaturesDetails[featureName] = true;
          }
        });
      });
    }

    const presentCount = Object.values(presentFeaturesDetails).filter(Boolean).length;
    
    let accessibilityType = 'inaccessible';
    if (presentCount >= 3) {
      accessibilityType = 'accessible';
    } else if (presentCount >= 1) {
      accessibilityType = 'partially';
    }

    const assessmentConfidence = presentCount > 0 ? Math.max(0.5, presentCount / required.length) : 0;
    
    const assessmentReasons = [];
    if (accessibilityType === 'accessible') {
      assessmentReasons.push('Multiple accessibility features are present.');
    } else if (accessibilityType === 'partially') {
      const detectedNames = Object.entries(presentFeaturesDetails)
                              .filter(([_, isPresent]) => isPresent)
                              .map(([name]) => getFeatureLabel(name)); 
      assessmentReasons.push(`Partially accessible: ${detectedNames.length} feature(s) detected.`);
      if(detectedNames.length > 0) assessmentReasons.push(`Detected: ${detectedNames.join(', ')}.`);
    } else {
      assessmentReasons.push('No accessibility features were detected.');
    }

    // Always allow submission if there's at least one feature with medium confidence or higher
    const isSubmissionValid = presentCount >= 1;
    
    setFeedbackValidation({
      isValid: isSubmissionValid,
      confidence: assessmentConfidence,
      reasons: assessmentReasons
    });

    return {
      type: accessibilityType,
      confidence: assessmentConfidence,
      reasons: assessmentReasons,
      score: assessmentConfidence
    };
  };

  // Update the takePanoramaPhoto function with improved error handling
  // Define common prompt text outside functions to avoid reference errors
  const analysisPromptText = `Analyze this image for SPECIFIC accessibility features.

  IMPORTANT: Only identify features that are CLEARLY visible in the image. Don't make assumptions or infer features that aren't directly visible.
  
  Carefully examine if the image contains ONLY the following accessibility features:
  1. Wheelchair ramps - ONLY if you can see actual sloped surfaces specifically designed for wheelchair access
  2. Elevators - ONLY if you can clearly see elevator doors, control panels, elevator cabins, or elevator signage
  3. Wide pathways - ONLY if you can see corridors or walkways that are visibly wide enough for wheelchairs
  4. Accessible restrooms (PWD) - ONLY if you can see restroom signs with wheelchair symbols or specifically designated PWD/accessible restroom facilities (regular restrooms without accessibility features should NOT be detected)
  
  DO NOT detect features unless they are clearly visible in the image. 
  DO NOT detect a feature if you only see something similar but not exactly matching the description.
  Each feature is distinct and should not be confused with others:
  - Elevators are NOT ramps
  - Ramps are NOT elevators
  - Restroom signs are NOT pathway indicators
  
  For each identified feature, provide:
  - "detected": true ONLY if you are certain the feature is present, otherwise false
  - "confidence": a score between 0-1 indicating your confidence
  - "characteristics": list specific visual elements you see in the image that led to your detection

  Respond in a structured JSON format like:
  {
    "wheelchairRamps": {"detected": true/false, "confidence": 0.X, "characteristics": []},
    "elevators": {"detected": true/false, "confidence": 0.X, "characteristics": []},
    "widePathways": {"detected": true/false, "confidence": 0.X, "characteristics": []},
    "pwdRestrooms": {"detected": true/false, "confidence": 0.X, "characteristics": []}
  }`;

  const takePanoramaPhoto = async () => {
    try {
      console.log('📷 Opening camera to take photo...');
      
      // Check stored permissions first
      const storedPermissions = await AsyncStorage.getItem('permissionsStatus');
      let hasCameraPermission = false;
      
      if (storedPermissions) {
        const parsedPermissions = JSON.parse(storedPermissions);
        hasCameraPermission = parsedPermissions.camera === true;
      }
      
      // Only request if not already granted
      if (!hasCameraPermission) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          console.log('❌ Camera permission denied');
          Alert.alert('Permission needed', 'Camera permission is required to take photos');
          return;
        }
        
        // Update stored permissions
        const updatedPermissions = storedPermissions ? 
          {...JSON.parse(storedPermissions), camera: true} :
          {camera: true};
        await AsyncStorage.setItem('permissionsStatus', JSON.stringify(updatedPermissions));
      }

      console.log('📸 Launching camera...');
      const result = await ImagePicker.launchCameraAsync({
        quality: Platform.OS === 'android' ? 0.6 : 0.8, // Lower quality on Android
        allowsEditing: false,
        exif: true,
        base64: false
      });

      if (!result.canceled && result.assets[0]) {
        console.log('✅ Photo captured successfully!');
        setAnalyzingPhotos(true);
        setLoading(false); // Don't use the regular loading indicator
        
        try {
          // Verify file exists and is accessible
          const fileInfo = await FileSystem.getInfoAsync(result.assets[0].uri);
          if (!fileInfo.exists) {
            throw new Error('Captured image file not found');
          }
          
          console.log(`Photo size: ${fileInfo.size / 1024}KB`);
          
          // Create new photo object but don't add to state yet
          const newPhoto = {
            uri: result.assets[0].uri,
            timestamp: new Date().toISOString(),
            exif: result.assets[0].exif,
            size: fileInfo.size,
            analysisResult: null, // Will store analysis results
            isValid: false // Will be set to true if analysis finds features
          };
          
          // Handle API connection issues
          if (!apiVerificationAttempted || !geminiApiVerified) {
            console.log('⚠️ API verification not complete, attempting verification now');
            await verifyGeminiApiConnectivity();
          }
          
          try {
            // Analyze the photo first before adding to collection
            console.log('🔍 Starting photo analysis with Gemini Vision...');
            
            let analysisResult;
            try {
              analysisResult = await analyzeImage(result.assets[0].uri);
              console.log('✨ Analysis completed successfully');
              
              // Check if the photo has valid accessibility features
              const hasDetectedFeatures = Object.values(analysisResult).some(feature => 
                feature.detected && feature.confidence > 0.25
              );
              
              // Update photo object with analysis results
              newPhoto.analysisResult = analysisResult;
              newPhoto.isValid = hasDetectedFeatures;
              
              // Only add valid photos to the collection
              if (hasDetectedFeatures) {
                console.log('📝 Adding validated photo to collection');
                setPhotos(prevPhotos => [...prevPhotos, newPhoto]);
                
                // Update selected filters with new features
                setSelectedFilters(prev => {
                  const newFilters = { ...prev };
                  Object.entries(analysisResult).forEach(([key, value]) => {
                    if (value.detected) newFilters[key] = true;
                  });
                  return newFilters;
                });

                // Show success message with detected features
                const detectedFeatures = Object.entries(analysisResult)
                  .filter(([_, value]) => value.detected)
                  .map(([key, value]) => {
                    const featureName = key === 'wheelchairRamps' ? 'Wheelchair Ramps' :
                                        key === 'elevators' ? 'Elevators' :
                                        key === 'widePathways' ? 'Wide Pathways' :
                                        key === 'pwdRestrooms' ? 'Accessible Restrooms' : key;
                    
                    return `${featureName} (${Math.round(value.confidence * 100)}%)`;
                  })
                  .join('\n• ');

                setTimeout(() => {
                  Alert.alert(
                    '✅ Valid Photo Added',
                    `Photo successfully analyzed and added!\n\n` +
                    `📸 Detected Features:\n• ${detectedFeatures}\n\n` +
                    `💡 Tip: Take more photos from different angles for better results.`,
                    [
                      {
                        text: "Take Another Photo",
                        onPress: () => takePanoramaPhoto(),
                        style: "default"
                      },
                      {
                        text: "Done",
                        style: "cancel"
                      }
                    ]
                  );
                }, 500);
              } else {
                // Photo has no detected features
                console.log('⚠️ No valid accessibility features detected in photo');
                
                Alert.alert(
                  '⚠️ No Features Detected',
                  `This photo doesn't clearly show accessibility features.\n\n` +
                  `Please take a clear photo of:\n` +
                  `• Wheelchair ramps\n` +
                  `• Elevators\n` +
                  `• Wide pathways\n` +
                  `• Accessible restrooms\n\n` +
                  `💡 Tips:\n` +
                  `• Ensure good lighting\n` +
                  `• Keep the camera steady\n` +
                  `• Show the full feature clearly`,
                  [
                    {
                      text: "Try Again",
                      onPress: () => takePanoramaPhoto(),
                      style: "default"
                    },
                    {
                      text: "Cancel",
                      style: "cancel"
                    }
                  ]
                );
              }
            } catch (analysisError) {
              console.error('❌ Analysis error:', analysisError);
              
              // Special handling for Android production builds
              if (Platform.OS === 'android') {
                Alert.alert(
                  'Analysis Issue',
                  'The image analysis service encountered an issue. Do you want to add the photo anyway?',
                  [
                    {
                      text: 'Add Photo Anyway',
                      onPress: () => {
                        // Add photo without validation
                        newPhoto.isValid = true; // Force valid
                        setPhotos(prevPhotos => [...prevPhotos, newPhoto]);
                        Alert.alert('Photo Added', 'Photo has been added without feature detection.');
                      },
                    },
                    {
                      text: "Cancel",
                      style: "cancel"
                    }
                  ]
                );
              } else {
                Alert.alert('Analysis Issue', 'The analysis failed. Please try taking the photo again.');
              }
            }
          } catch (analysisError) {
            console.error('❌ Error analyzing photo:', analysisError);
            Alert.alert('Analysis Issue', 'There was a problem analyzing your photo.');
          }
        } catch (fileError) {
          console.error('❌ File error:', fileError);
          Alert.alert('Photo Issue', 'There was a problem processing the photo. Please try again.');
        } finally {
          // Delay hiding the animation to ensure the user sees the completion
          setTimeout(() => {
            setAnalyzingPhotos(false);
            setLoading(false); // Ensure loading state is reset
          }, 1000);
        }
      } else {
        console.log('⚠️ Camera operation canceled or no photo taken');
      }
    } catch (error) {
      console.error('❌ Error taking photo:', error);
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
      setAnalyzingPhotos(false);
      setLoading(false);
    } finally {
      setAnalyzingPhotos(false);
      setLoading(false);
      console.log('📷 Photo capture process completed');
    }
  };

  // Add function to remove a photo
  const removePhoto = (index) => {
    setPhotos(prevPhotos => prevPhotos.filter((_, i) => i !== index));
  };

  // Update the addFeedback function for cleaner flow
  const addFeedback = async () => {
    if (!location || photos.length === 0) {
      Alert.alert("Missing Information", "Please provide at least one photo");
      return;
    }

    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      setAnalyzingPhotos(true);
      setLoading(false);

      // We don't need to analyze photos again since they're already validated during capture
      // Just filter for valid photos (in case any were manually added)
      const validPhotos = photos.filter(photo => photo.isValid);

      if (validPhotos.length === 0) {
        Alert.alert(
          "No Valid Photos",
          "None of your photos show clear accessibility features. Please take new photos.",
          [
            {
              text: "Take New Photos",
              onPress: () => {
                setLoading(false);
                setIsSubmitting(false);
                setPhotos([]);
                takePanoramaPhoto();
              },
              style: "default"
            },
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => {
                setLoading(false);
                setIsSubmitting(false);
              }
            }
          ]
        );
        return;
      }

      // Get analysis results that were saved with each photo
      const allAnalysisResults = validPhotos
        .map(photo => photo.analysisResult)
        .filter(result => result !== null);

      // Determine overall accessibility from the existing analysis results
      const accessibilityResult = determineAccessibility(allAnalysisResults);

      console.log('Converting photos to base64 for storage...');
      
      // Convert valid photos to base64 strings for storage
      const base64Photos = await Promise.all(
        validPhotos.map(async (photo) => {
          try {
            // Skip conversion if already a base64 string
            if (typeof photo.uri === 'string' && photo.uri.startsWith('data:image')) {
              return photo.uri.split(',')[1];
            }
            const base64Image = await convertImageToBase64(photo.uri);
            return base64Image;
          } catch (error) {
            console.error('Error converting image:', error);
            return null;
          }
        })
      );

      // Filter out failed conversions
      const validBase64Photos = base64Photos.filter(photo => photo !== null);
      
      if (validBase64Photos.length === 0) {
        Alert.alert("Error", "Failed to process photos. Please try again.");
        setIsSubmitting(false);
        setAnalyzingPhotos(false);
        setLoading(false);
        return;
      }

      // Extract detected features from analysis results
      const detectedFeatures = allAnalysisResults.flatMap(result => 
        Object.entries(result || {})
          .filter(([_, feature]) => feature.detected && feature.confidence > 0.25)
          .map(([name, feature]) => ({
            name,
            confidence: feature.confidence
          }))
      );

      console.log('Creating feedback object...');
      
      // Create feedback object with all validated data
      const newFeedback = {
        coordinate: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        type: accessibilityResult.type,
        confidence: accessibilityResult.confidence,
        features: [...new Set(detectedFeatures.map(f => f.name))], // Remove duplicates
        photos: validBase64Photos,
        comment: comment,
        timestamp: new Date().toISOString(),
        status: 'approved',
        userId: user.uid,
        userEmail: user.email || 'Unknown User',
        userName: user.displayName || 'Anonymous',
        validation: {
          isValid: true,
          confidence: accessibilityResult.confidence,
          reasons: accessibilityResult.reasons,
          detectedFeatures: detectedFeatures,
          validPhotoCount: validPhotos.length,
          totalPhotoCount: photos.length
        },
        floor: selectedFloor,
        building: building
      };

      console.log('Saving feedback to Firestore...');
      
      // Add to Firestore
      const feedbackRef = collection(db, 'accessibility_feedback');
      await addDoc(feedbackRef, newFeedback);

      // Format features for display
      const featureList = [...new Set(detectedFeatures.map(f => f.name))] // Remove duplicates
        .map(name => `${getFeatureLabel(name)} (${(
          detectedFeatures.find(f => f.name === name)?.confidence * 100 || 0
        ).toFixed(1)}%)`)
        .join('\n• ');

      Alert.alert(
        "Success", 
        `Feedback submitted successfully!\n\nFloor: ${selectedFloor}\nBuilding: ${building || 'Not specified'}\n\nDetected Features:\n• ${featureList}\n\nSubmitted ${validPhotos.length} valid photo(s)`
      );
      
      // Show local notification to the user who added the feedback
      showLocalNotification(
        'New Feedback Added',
        `You've successfully added a new location to the map.`
      );
      
      // Notify all other users about the new feedback
      try {
        // Get all users
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        
        // Notification data for other users
        const notificationData = {
          title: 'New Location Added',
          body: `A new location has been added to the map`,
          data: {
            type: 'map_updated',
            updateType: 'new_location'
          }
        };
        
        // Send notification to each user
        const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
          const userData = userDoc.data();
          const pushToken = userData.expoPushToken;
          
          if (pushToken && userDoc.id !== user.uid) { // Don't send to self
            try {
              // Use Expo's push notification service
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  to: pushToken,
                  title: notificationData.title,
                  body: notificationData.body,
                  data: notificationData.data,
                }),
              });
              console.log(`Notification sent to user: ${userDoc.id}`);
            } catch (error) {
              console.error('Error sending notification to user:', error);
            }
          }
        });
        
        await Promise.all(notificationPromises);
        console.log('Notifications sent to all users');
      } catch (error) {
        console.error('Error sending notifications to all users:', error);
      }
      
      resetFeedbackForm();

    } catch (error) {
      console.error('Error submitting feedback:', error);
      Alert.alert("Error", "Failed to submit feedback. Please try again.");
    } finally {
      setTimeout(() => {
        setAnalyzingPhotos(false);
        setLoading(false);
        setIsSubmitting(false);
      }, 1000);
    }
  };

  // Update the resetFeedbackForm function to preserve selected filters
  const resetFeedbackForm = () => {
    setAddingFeedback(false);
    setComment('');
    setSelectedFloor('G');
    setBuilding('');
    setValidationErrors({});
    setShowBuildingDropdown(false);
    
    // We'll keep the selected filters as they were
    // so users don't lose their filter settings when adding feedback
    
    setPhotos([]);
  };

  // Update the bottom sheet UI to show multiple photos
  const renderPhotoGrid = () => (
    <View style={styles.photoGrid}>
      {photos.map((photo, index) => (
        <View key={index} style={styles.photoContainer}>
          <Image source={{ uri: photo.uri }} style={styles.photoThumbnail} />
          <TouchableOpacity
            style={styles.removePhotoButton}
            onPress={() => removePhoto(index)}
          >
            <Ionicons name="close-circle" size={24} color="red" />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        style={styles.addPhotoButton}
        onPress={takePanoramaPhoto}
      >
        <Ionicons name="camera" size={24} color="#2196F3" />
        <Text style={styles.addPhotoText}>Add Photo</Text>
      </TouchableOpacity>
    </View>
  );

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

  // Update shouldDisplayFeedback function to filter based on features
  const shouldDisplayFeedback = (feedback) => {
    // Check if feedback has features
    if (!feedback.features || feedback.features.length === 0) {
      return false;
    }
    
    // Check if any selected feature filter matches this feedback
    const hasSelectedFilters = Object.entries(selectedFilters).some(([key, value]) => value === true);
    
    if (!hasSelectedFilters) {
      // If no filters selected, show all feedbacks
      return true;
    }
    
    // Show only feedbacks that have at least one of the selected features
    return feedback.features.some(feature => selectedFilters[feature]);
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

  // Add this function to handle real-time updates
  useEffect(() => {
    if (!user) return;

    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds

    // Subscribe to notifications
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
      // Refresh data when notification is received
      fetchInitialFeedback();
    });

    // Subscribe to Firestore changes with retry logic
    const setupFirestoreListener = () => {
      const feedbackRef = collection(db, 'accessibility_feedback');
      const q = query(feedbackRef, where('status', '==', 'approved'));
      
      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          // Reset retry count on successful connection
          retryCount = 0;
          
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified') {
              console.log('Feedback updated:', change.doc.data());
              fetchInitialFeedback();
            }
          });
        },
        (error) => {
          console.error('Firestore listener error:', error);
          
          // Attempt to reconnect if we haven't exceeded max retries
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Attempting to reconnect (${retryCount}/${maxRetries})...`);
            setTimeout(setupFirestoreListener, retryDelay);
          } else {
            console.error('Max retry attempts reached. Please check your connection.');
            Alert.alert(
              'Connection Error',
              'Unable to maintain connection to the server. Please check your internet connection and try again.'
            );
          }
        }
      );

      return unsubscribe;
    };

    const unsubscribe = setupFirestoreListener();

    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [user]);

  // Update the handleNormalApproval function
  const handleNormalApproval = async (feedbackId, newFeedback) => {
    try {
      await updateDoc(doc(db, 'accessibility_feedback', feedbackId), {
        status: 'approved',
        reviewedBy: user.uid,
        reviewedAt: new Date().toISOString()
      });

      // Send notification to all users
      const notificationData = {
        title: 'Accessibility Map Updated',
        body: `New ${newFeedback.type} location has been added to the map!`,
        data: {
          type: 'map_updated',
          feedbackId: feedbackId,
          feedbackType: newFeedback.type,
          updateType: 'new_location'
        }
      };

      // Get all users
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      // Send notification to each user
      const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
        const userData = userDoc.data();
        if (userData.expoPushToken) {
          try {
            await Notifications.scheduleNotificationAsync({
              content: notificationData,
              trigger: null, // null means show immediately
            });
          } catch (error) {
            console.error('Error sending notification to user:', error);
          }
        }
      });

      await Promise.all(notificationPromises);

      // Update local state
      const approvedFeedback = {
        id: feedbackId,
        ...newFeedback,
        status: 'approved'
      };
      
      setFeedbacks(prev => [...prev, approvedFeedback]);
      // Update feedback data - we don't need heatmap weights anymore
      setFeedbackData(prev => ({
        ...prev,
        [newFeedback.type]: [...(prev[newFeedback.type] || []), {
          latitude: newFeedback.coordinate.latitude,
          longitude: newFeedback.coordinate.longitude,
        }]
      }));

      Alert.alert("Success", `New ${newFeedback.type} location has been approved`);
      setModalVisible(false);
      fetchInitialFeedback();
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
      
      // Update new feedback
      await updateDoc(doc(db, 'accessibility_feedback', newFeedbackId), {
        status: 'approved',
        reviewedBy: user.uid,
        reviewedAt: new Date().toISOString()
      });

      // Send notification to all users
      const notificationData = {
        title: 'Accessibility Map Updated',
        body: `A location on the map has changed from ${existingFeedback.type} to ${newFeedback.type} status`,
        data: {
          type: 'map_updated',
          feedbackId: newFeedbackId,
          feedbackType: newFeedback.type,
          previousType: existingFeedback.type,
          updateType: 'status_changed'
        }
      };

      // Get all users
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      // Send notification to each user
      const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
        const userData = userDoc.data();
        if (userData.expoPushToken) {
          try {
            await Notifications.scheduleNotificationAsync({
              content: notificationData,
              trigger: null,
            });
          } catch (error) {
            console.error('Error sending notification to user:', error);
          }
        }
      });

      await Promise.all(notificationPromises);

      // Update local states
      const approvedFeedback = {
        id: newFeedbackId,
        ...newFeedback,
        status: 'approved'
      };
      
      setFeedbacks(prev => [...prev, approvedFeedback]);
      // Update feedback data - we no longer need heatmap weights
      setFeedbackData(prev => ({
        ...prev,
        [existingFeedback.type]: prev[existingFeedback.type].filter(point => 
          point.latitude !== existingFeedback.coordinate.latitude ||
          point.longitude !== existingFeedback.coordinate.longitude
        ),
        [newFeedback.type]: [...(prev[newFeedback.type] || []), {
          latitude: newFeedback.coordinate.latitude,
          longitude: newFeedback.coordinate.longitude
        }]
      }));

      Alert.alert("Success", `Location has been updated to ${newFeedback.type} accessibility status`);
      setModalVisible(false);
      fetchInitialFeedback();
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
                fetchInitialFeedback();
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
        
        // Handle specific notification types
        const notificationType = notification.request?.content?.data?.type;
        
        if (notificationType === 'map_updated') {
          // Refresh the heatmap data when a map update notification is received
          fetchInitialFeedback();
          
          // If the notification includes location info, we could potentially focus the map there
          const feedbackType = notification.request?.content?.data?.feedbackType;
          const updateType = notification.request?.content?.data?.updateType;
          
          console.log(`Map updated: ${updateType} - ${feedbackType}`);
          
          // For future enhancement: You could add additional actions based on update type
          // For example: Highlight the updated area, zoom to location, etc.
        }
      });

      // Cleanup
      return () => {
        subscription.remove();
      };
    }, []);

    return null;
  };

  // Update the getLocationName function
  const getLocationName = async (latitude, longitude) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'en',
            'User-Agent': 'Gabay-App'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (data && data.display_name) {
          return data.display_name;
        }
        return 'Unknown Location';
      } catch (parseError) {
        console.error('Error parsing JSON:', parseError);
        return 'Unknown Location';
      }
    } catch (error) {
      console.error('Error getting location name:', error);
      return 'Unknown Location';
    }
  };

  // Update the AllPointsModal component
  const AllPointsModal = () => {
    const [locationNames, setLocationNames] = useState({});
    const [filteredFeedbacks, setFilteredFeedbacks] = useState([]);

    useEffect(() => {
      const fetchLocationNames = async () => {
        const names = {};
        for (const feedback of feedbacks) {
          const name = await getLocationName(
            feedback.coordinate.latitude,
            feedback.coordinate.longitude
          );
          names[feedback.id] = name;
        }
        setLocationNames(names);
      };

      fetchLocationNames();
    }, [feedbacks]);

    // Filter feedbacks based on accessibility type
    useEffect(() => {
      const filtered = feedbacks.filter(feedback => 
        accessibilityFilters[feedback.type]
      );
      setFilteredFeedbacks(filtered);
    }, [feedbacks, accessibilityFilters]);

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={showAllPointsModal}
        onRequestClose={() => setShowAllPointsModal(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.allPointsModalView}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>All Accessibility Points</Text>
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={() => setShowAllPointsModal(false)}
              >
                <Ionicons name="close" size={24} color="#9E9E9E" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.allPointsScrollView}>
              {filteredFeedbacks.map((feedback) => (
                <View key={feedback.id} style={styles.feedbackCard}>
                  <View style={styles.feedbackHeader}>
                    <Text style={styles.feedbackType}>
                      {getAccessibilityTypeLabel(feedback.type)}
                    </Text>
                    <View style={styles.featuresIconContainer}>
                      {feedback.features && feedback.features.map((feature, idx) => {
                        let iconName;
                        let iconColor;
                        
                        switch(feature) {
                          case 'wheelchairRamps':
                            iconName = 'accessibility-outline';
                            iconColor = '#4CAF50';
                            break;
                          case 'elevators':
                            iconName = 'arrow-up-outline';
                            iconColor = '#2196F3';
                            break;
                          case 'widePathways':
                            iconName = 'resize-outline';
                            iconColor = '#FF9800';
                            break;
                          case 'pwdRestrooms':
                            iconName = 'water-outline';
                            iconColor = '#9C27B0';
                            break;
                          default:
                            iconName = 'location-outline';
                            iconColor = '#9E9E9E';
                        }
                        
                        return (
                          <View key={`${feedback.id}-${feature}`} style={styles.featureIcon}>
                            <Ionicons name={iconName} size={16} color={iconColor} />
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  {feedback.photos && feedback.photos.length > 0 && (
                    <View style={styles.imageContainer}>
                      <Image 
                        source={{ uri: `data:image/jpeg;base64,${feedback.photos[0]}` }}
                        style={styles.feedbackImage}
                        resizeMode="cover"
                      />
                      {feedback.photos.length > 1 && (
                        <View style={styles.morePhotosIndicator}>
                          <Text style={styles.morePhotosText}>+{feedback.photos.length - 1} more</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {feedback.features && feedback.features.length > 0 && (
                    <View style={styles.featuresContainer}>
                      <Text style={styles.sectionTitle}>Features:</Text>
                      <View style={styles.featuresList}>
                        {feedback.features.map((feature, index) => (
                          <View key={index} style={styles.featureItem}>
                            <Ionicons
                              name={
                                feature === 'wheelchairRamps' ? 'accessibility-outline' :
                                feature === 'elevators' ? 'arrow-up-outline' :
                                feature === 'chairs' ? 'home-outline' :
                                feature === 'pwdRestrooms' ? 'water-outline' :
                                'resize-outline'
                              }
                              size={16}
                              color="#40B59F"
                            />
                            <Text style={styles.featureText}>
                              {getFeatureLabel(feature)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {feedback.comment && (
                    <View style={styles.commentContainer}>
                      <Text style={styles.sectionTitle}>Comment:</Text>
                      <Text style={styles.commentText}>{feedback.comment}</Text>
                    </View>
                  )}

                  <View style={styles.locationContainer}>
                    <Text style={styles.sectionTitle}>Location:</Text>
                    <Text style={styles.locationText}>
                      {locationNames[feedback.id] || 'Loading location...'}
                    </Text>
                    <Text style={styles.coordinatesText}>
                      Lat: {feedback.coordinate.latitude.toFixed(6)}{'\n'}
                      Long: {feedback.coordinate.longitude.toFixed(6)}
                    </Text>
                    {feedback.floor && (
                      <Text style={styles.floorText}>
                        Floor: {feedback.floor}
                      </Text>
                    )}
                    {feedback.building && (
                      <Text style={styles.buildingText}>
                        Building: {feedback.building}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // Add function to calculate dynamic radius based on zoom level
  const calculateRadius = (zoomLevel) => {
    // Ensure zoomLevel is a valid number
    if (typeof zoomLevel !== 'number' || isNaN(zoomLevel)) {
      return 20; // Default radius if zoom level is invalid
    }
    
    // Base radius of 20 meters
    const baseRadius = 20;
    // Adjust radius based on zoom level, with a minimum of 5 and maximum of 50
    const calculatedRadius = Math.max(5, Math.min(50, baseRadius * Math.pow(2, 15 - zoomLevel)));
    return calculatedRadius;
  };

  // Add this function to handle zoom changes
  const handleRegionChange = (region) => {
    try {
      // Calculate zoom level from region
      const zoom = Math.round(Math.log(360 / region.longitudeDelta) / Math.LN2);
      // Ensure zoom is within valid range (5-19)
      const validZoom = Math.max(5, Math.min(19, zoom));
      setZoomLevel(validZoom);
    } catch (error) {
      console.error('Error calculating zoom level:', error);
      setZoomLevel(15); // Default zoom level if calculation fails
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
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: "c8cb54d9-e7a3-4dd2-a327-013a9656fb34"
      });
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
      // Get all users with their push tokens
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      // Create notification data
      const notificationData = {
        title: 'New Location Added',
        body: `A new ${feedbackType} location has been added to the map`,
        timestamp: new Date().toISOString(),
        type: 'new_feedback',
        location: location,
        status: 'unread'
      };

      // Create notification document
      const notificationRef = await addDoc(collection(db, 'notifications'), notificationData);

      // Send push notifications to all users with tokens
      let skippedCount = 0;
      const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
        const userData = userDoc.data();
        if (userData.expoPushToken && userDoc.id !== user.uid) { // Don't send to self
          try {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: userData.expoPushToken,
                title: notificationData.title,
                body: notificationData.body,
                data: {
                  ...notificationData,
                  notificationId: notificationRef.id
                },
              }),
            });
            console.log(`Notification sent to user: ${userDoc.id}`);
          } catch (error) {
            console.error('Error sending push notification to user:', error);
          }
        } else {
          skippedCount++;
        }
      });

      await Promise.all(notificationPromises);
      console.log(`Notifications sent. Skipped ${skippedCount} users due to missing push tokens.`);
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

  // Enhanced function to handle image conversion to base64
  const convertImageToBase64 = async (uri) => {
    try {
      console.log('🔄 Starting image conversion to base64...');
      
      // Skip if already a base64 string
      if (typeof uri === 'string' && uri.startsWith('data:image')) {
        console.log('✅ Image is already in base64 format');
        return uri.split(',')[1];
      }
      
      // First, verify file exists
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        console.error('❌ Image file not found');
        throw new Error('Image file not found');
      }
      
      console.log(`📊 Original image size: ${(fileInfo.size / 1024).toFixed(1)}KB`);
      
      // Determine compression parameters based on environment and platform
      const isLowQuality = ENV !== 'development' || Platform.OS === 'android';
      const initialWidth = isLowQuality ? 500 : 600;
      const initialQuality = isLowQuality ? 0.5 : 0.6;
      
      console.log(`🔧 Using ${isLowQuality ? 'low' : 'standard'} quality settings`);
      
      // First compression pass
      const compressedImage = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: initialWidth } }],
        { compress: initialQuality, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Check compressed size
      let finalImage = compressedImage;
      const compressedFileInfo = await FileSystem.getInfoAsync(compressedImage.uri);
      console.log(`📊 Compressed image size: ${(compressedFileInfo.size / 1024).toFixed(1)}KB`);
      
      // Target size is 300KB for production, 500KB for development
      const targetSize = ENV !== 'development' ? 300 * 1024 : 500 * 1024;
      
      // If still too large, compress further
      if (compressedFileInfo.size > targetSize) {
        console.log('📉 Image still too large, compressing further');
        
        // Calculate more aggressive compression parameters
        const ratio = targetSize / compressedFileInfo.size;
        const secondWidth = Math.min(400, Math.floor(initialWidth * Math.sqrt(ratio)));
        const secondQuality = Math.min(0.4, initialQuality * ratio);
        
        console.log(`🔧 Second compression: width=${secondWidth}, quality=${secondQuality.toFixed(2)}`);
        
        finalImage = await ImageManipulator.manipulateAsync(
          compressedImage.uri,
          [{ resize: { width: secondWidth } }],
          { compress: secondQuality, format: ImageManipulator.SaveFormat.JPEG }
        );
        
        const finalFileInfo = await FileSystem.getInfoAsync(finalImage.uri);
        console.log(`📊 Final image size: ${(finalFileInfo.size / 1024).toFixed(1)}KB`);
      }

      // Convert to base64
      console.log('🔄 Converting image to base64 string...');
      const base64 = await FileSystem.readAsStringAsync(finalImage.uri, 
        { encoding: FileSystem.EncodingType.Base64 });
      
      console.log(`✅ Base64 conversion complete. Length: ${base64.length} chars`);
      return base64;
    } catch (error) {
      console.error('❌ Error converting image:', error);
      throw error;
    }
  };

  // Help modal content
  const renderHelpModal = () => (
    <Modal
      visible={helpModalVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setHelpModalVisible(false)}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ backgroundColor: '#f9fafd', borderRadius: 18, paddingVertical: 18, paddingHorizontal: 0, width: '92%', maxWidth: 420, elevation: 6, maxHeight: '85%' }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#1976D2', marginBottom: 10, textAlign: 'center' }}>Photo Guide & Accessibility Types</Text>

            <Text style={{ fontSize: 16, fontWeight: '600', color: '#2196F3', marginBottom: 8, marginTop: 6 }}>How to Take Good Photos</Text>
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                <Ionicons name="walk" size={18} color="#40B59F" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={{ fontSize: 15, flex: 1 }}><Text style={{ fontWeight: 'bold' }}>Wheelchair Ramps:</Text> Show the full ramp from the side, including the slope and both ends.</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                <Ionicons name="cube" size={18} color="#40B59F" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={{ fontSize: 15, flex: 1 }}><Text style={{ fontWeight: 'bold' }}>Elevators:</Text> Take a clear photo of the elevator doors and any accessibility signs.</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                <Ionicons name="swap-horizontal" size={18} color="#40B59F" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={{ fontSize: 15, flex: 1 }}><Text style={{ fontWeight: 'bold' }}>Wide Pathways:</Text> Photograph the length of the corridor or hallway, showing it is clear and wide.</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                <Ionicons name="water" size={18} color="#40B59F" style={{ marginRight: 8, marginTop: 2 }} />
                <Text style={{ fontSize: 15, flex: 1 }}><Text style={{ fontWeight: 'bold' }}>PWD Restrooms:</Text> Show the restroom entrance and any accessibility symbols.</Text>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: '#e3e8ee', marginVertical: 10, borderRadius: 1 }} />

            <Text style={{ fontSize: 16, fontWeight: '600', color: '#2196F3', marginBottom: 8, marginTop: 2 }}>Tips for Best Results</Text>
            <View style={{ marginBottom: 12, marginLeft: 2 }}>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>• Use good lighting and keep the camera steady.</Text>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>• Make sure the feature is in focus and not blocked by people.</Text>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>• Take a clear photo of at least one accessibility feature.</Text>
            </View>

            <View style={{ height: 1, backgroundColor: '#e3e8ee', marginVertical: 10, borderRadius: 1 }} />

            <Text style={{ fontSize: 16, fontWeight: '600', color: '#2196F3', marginBottom: 8, marginTop: 2 }}>How Accessibility Type is Determined</Text>
            <View style={{ marginBottom: 10, marginLeft: 2 }}>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>• <Text style={{ fontWeight: 'bold' }}>Accessible:</Text> Three or more accessibility features present.</Text>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>• <Text style={{ fontWeight: 'bold' }}>Partially Accessible:</Text> One or two features present.</Text>
              <Text style={{ fontSize: 15, marginBottom: 2 }}>• <Text style={{ fontWeight: 'bold' }}>Inaccessible:</Text> No features detected.</Text>
              <Text style={{ fontSize: 15, marginTop: 6, color: '#666' }}>You can submit feedback with just one clear photo of an accessibility feature. The app will analyze your photo and determine the accessibility level.</Text>
            </View>

            <TouchableOpacity
              style={{ marginTop: 18, alignSelf: 'center', backgroundColor: '#2196F3', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 32, elevation: 2 }}
              onPress={() => setHelpModalVisible(false)}
            >
              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 17 }}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // Debug helper function to test image recognition on a sample image
  const testImageRecognition = async () => {
    try {
      console.log('🧪 RUNNING TEST IMAGE RECOGNITION');
      // Pick an image from the gallery to test
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });
      
      if (!result.canceled && result.assets[0]) {
        console.log('📸 Test image selected:', result.assets[0].uri);
        Alert.alert('Testing Image Recognition', 'Analyzing test image...');
        
        // Run the analysis
        const analysisResult = await analyzeImage(result.assets[0].uri);
        
        // Display the results
        const features = Object.entries(analysisResult)
          .map(([key, value]) => `${key}: ${value.detected ? '✓' : '✗'} (${(value.confidence * 100).toFixed(1)}%)`)
          .join('\n');
          
        Alert.alert('Test Results', `Analysis Results:\n${features}`);
      }
    } catch (error) {
      console.error('❌ Test error:', error);
      Alert.alert('Test Error', 'Failed to run test: ' + error.message);
    }
  };

  // Update state variables
  const [selectedFloor, setSelectedFloor] = useState('G');
  const [building, setBuilding] = useState('');
  const [showBuildingDropdown, setShowBuildingDropdown] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  // Add common building/section options
  const commonBuildings = [
    'Main Building',
    'North Wing',
    'South Wing',
    'East Wing',
    'West Wing',
    'Food Court',
    'Entertainment Area',
    'Shopping Area',
    'Parking Building',
    'Office Tower',
    'Residential Tower',
    'Other'
  ];

  // Add validation function
  const validateFeedback = () => {
    const errors = {};
    if (!building.trim()) {
      errors.building = 'Please specify the building or section';
    }
    if (photos.length === 0) {
      errors.photos = 'Please add at least one photo';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Update floor selection component with more options
  const renderFloorSelector = () => (
    <View style={styles.floorSelector}>
      <Text style={styles.sectionTitle}>Floor Level</Text>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.floorButtonsContainer}
      >
        {['G', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((floor) => (
          <TouchableOpacity
            key={floor}
            style={[
              styles.floorButton,
              selectedFloor === floor && styles.selectedFloorButton
            ]}
            onPress={() => setSelectedFloor(floor)}
          >
            <Text style={[
              styles.floorButtonText,
              selectedFloor === floor && styles.selectedFloorButtonText
            ]}>{floor}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // Update building/section selector with dropdown
  const renderBuildingSelector = () => (
    <View style={styles.buildingSelector}>
      <Text style={styles.sectionTitle}>Building/Section</Text>
      <TouchableOpacity
        style={[
          styles.buildingInput,
          validationErrors.building && styles.inputError
        ]}
        onPress={() => setShowBuildingDropdown(true)}
      >
        <Text style={[
          styles.buildingInputText,
          !building && styles.placeholderText
        ]}>
          {building || 'Select building or section'}
        </Text>
        <Ionicons name="chevron-down" size={20} color="#666" />
      </TouchableOpacity>
      
      {validationErrors.building && (
        <Text style={styles.errorText}>{validationErrors.building}</Text>
      )}

      {showBuildingDropdown && (
        <View style={styles.dropdownContainer}>
          <ScrollView style={styles.dropdownList}>
            {commonBuildings.map((item) => (
              <TouchableOpacity
                key={item}
                style={styles.dropdownItem}
                onPress={() => {
                  setBuilding(item);
                  setShowBuildingDropdown(false);
                  setValidationErrors(prev => ({ ...prev, building: null }));
                }}
              >
                <Text style={styles.dropdownItemText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={styles.customInputButton}
            onPress={() => {
              setShowBuildingDropdown(false);
              // Show custom input modal
              Alert.prompt(
                'Custom Building/Section',
                'Enter building or section name:',
                [
                  {
                    text: 'Cancel',
                    style: 'cancel',
                  },
                  {
                    text: 'OK',
                    onPress: (value) => {
                      if (value) {
                        setBuilding(value);
                        setValidationErrors(prev => ({ ...prev, building: null }));
                      }
                    },
                  },
                ],
                'plain-text',
                building
              );
            }}
          >
            <Text style={styles.customInputText}>+ Add Custom</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // Update the bottom sheet UI to include new components
  const renderBottomSheet = () => (
    <View style={styles.bottomSheet}>
      <BottomSheetHeader
        title="Add Location"
        onClose={resetFeedbackForm}
        onHelp={() => setHelpModalVisible(true)}
      />
      
      {renderFloorSelector()}
      {renderBuildingSelector()}
      
      <Text style={styles.sectionTitle}>
        Photos <Text style={styles.requiredText}>*</Text>
      </Text>
      
      {renderPhotoGrid()}

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
          disabled={isSubmitting}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
        
        {renderSubmitButton()}
      </View>
    </View>
  );

  if (!location) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#40B59F" />
        <Text style={styles.loadingText}>Loading map...</Text>
        {mapError && (
          <Text style={styles.errorText}>{mapError}</Text>
        )}
      </View>
    );
  }

  if (mapError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="location-off" size={48} color="#F44336" />
          <Text style={styles.errorText}>{mapError}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={retryLocationInitialization}
          >
            <Ionicons name="refresh" size={20} color="white" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Update the submit button in the bottom sheet
  const renderSubmitButton = () => (
    <TouchableOpacity
      style={[
        styles.submitButton,
        (photos.length === 0 || isSubmitting) && styles.disabledButton
      ]}
      onPress={addFeedback}
      disabled={photos.length === 0 || isSubmitting}
    >
      <Text style={styles.buttonText}>
        {isSubmitting ? 'Submitting...' : 'Submit'}
      </Text>
    </TouchableOpacity>
  );

  // Update the return statement to use the new bottom sheet renderer
  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={location}
        showsUserLocation={true}
        showsMyLocationButton={true}
        showsCompass={true}
        showsScale={true}
        toolbarEnabled={false}
        onRegionChangeComplete={handleRegionChange}
        onMapReady={() => {
          console.log('Map is ready');
          fetchInitialFeedback();
        }}
        onError={(error) => {
          console.error('Map error:', error);
          setMapError(error.message || 'Failed to load map');
        }}
      >
        {/* Render all features as icons on the map */}
{feedbacks.filter(shouldDisplayFeedback).map((feedback) => {
  // Create markers for each feature in the feedback
  if (feedback.features && feedback.features.length > 0) {
    return feedback.features.map((feature, index) => {
      // Different icon based on feature type
      let iconName;
      let iconColor;
      
      switch(feature) {
        case 'wheelchairRamps':
          iconName = 'accessibility-outline';
          iconColor = 'rgba(76, 175, 80, 0.85)'; // Softer green
          break;
        case 'elevators':
          iconName = 'arrow-up-outline';
          iconColor = 'rgba(33, 150, 243, 0.85)'; // Softer blue
          break;
        case 'widePathways':
          iconName = 'resize-outline';
          iconColor = 'rgba(255, 152, 0, 0.85)'; // Softer orange
          break;
        case 'pwdRestrooms':
          iconName = 'water-outline';
          iconColor = 'rgba(156, 39, 176, 0.85)'; // Softer purple
          break;
        default:
          iconName = 'location-outline';
          iconColor = 'rgba(158, 158, 158, 0.85)'; // Softer gray
      }

      // Add a small offset to each feature marker to avoid overlap
      // Offset pattern: N, E, S, W, NE, SE, SW, NW for better spacing
      const offsetPatterns = [
        { latOffset: 0.00004, lngOffset: 0 },          // N
        { latOffset: 0, lngOffset: 0.00004 },          // E
        { latOffset: -0.00004, lngOffset: 0 },         // S
        { latOffset: 0, lngOffset: -0.00004 },         // W
        { latOffset: 0.000028, lngOffset: 0.000028 },  // NE
        { latOffset: -0.000028, lngOffset: 0.000028 }, // SE
        { latOffset: -0.000028, lngOffset: -0.000028 }, // SW
        { latOffset: 0.000028, lngOffset: -0.000028 }, // NW
      ];
      
      const offset = offsetPatterns[index % offsetPatterns.length];
      
      return (
        <Marker
          key={`${feedback.id}-${feature}-${index}`}
          coordinate={{
            latitude: feedback.coordinate.latitude + offset.latOffset,
            longitude: feedback.coordinate.longitude + offset.lngOffset,
          }}
          onPress={() => handleCirclePress(feedback)}
        >
          <View style={styles.markerContainer}>
            <View style={[styles.markerIconContainer, { backgroundColor: iconColor }]}>
              <Ionicons name={iconName} size={16} color="white" />
            </View>
          </View>
        </Marker>
      );
    });
  }
  
  // Fallback if no features
  return (
    <Marker
      key={feedback.id}
      coordinate={feedback.coordinate}
      onPress={() => handleCirclePress(feedback)}
    >
      <View style={styles.markerContainer}>
                  <View style={[styles.markerIconContainer, { backgroundColor: '#9E9E9E' }]}>
            <Ionicons name="location-outline" size={16} color="white" />
          </View>
      </View>
    </Marker>
  );
})}
      </MapView>

      <Legend />
      
      {/* Update filter controls container */}
      <View style={styles.filterControlsContainer}>
        <FilterToggleButton />
        
        {AccessibilityTypeFilter()}
      </View>

      <TouchableOpacity
        style={styles.addButton}
        onPress={() => setAddingFeedback(true)}
      >
        <Ionicons name="add" size={24} color="white" />
      </TouchableOpacity>

      {addingFeedback && renderBottomSheet()}

      {renderHelpModal()}

      {loading && <AnalyzingAnimation visible={loading} />}
      {analyzingPhotos && <AnalyzingAnimation visible={analyzingPhotos} isPhotoAnalysis={true} />}

      <NotificationListener />

      <TouchableOpacity
        style={styles.showAllButton}
        onPress={() => setShowAllPointsModal(true)}
      >
        <Ionicons name="list" size={22} color="white" />
        <Text style={styles.showAllButtonText}>All Points</Text>
      </TouchableOpacity>

      <AllPointsModal />
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
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 10,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
    minWidth: 90,
    zIndex: 5,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: '500',
    color: '#444',
    marginLeft: 4,
  },
  legendItems: {
    gap: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendIconWrapper: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendText: {
    fontSize: 10,
    color: '#555',
  },
  
  // Filter controls
  filterControlsContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
    width: 160,
  },
  filterToggleButton: {
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  filterToggleText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 5,
  },
  accessibilityFilterContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    padding: 10,
    paddingBottom: 12,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 4,
  },
  filterTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  accessibilityFilterButtons: {
    flexDirection: 'column',
    gap: 10,
  },
  accessibilityFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    gap: 8,
    marginBottom: 2,
  },
  activeAccessibilityFilter: {
    backgroundColor: 'rgba(227, 242, 253, 0.8)',
    borderColor: '#BBDEFB',
  },
  filterIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#555',
    flex: 1,
  },
  activeFilterText: {
    color: '#1976D2',
    fontWeight: '600',
  },
  
  // Marker styles
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
  },
  markerIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  
  // Add button
  addButton: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: '#2196F3',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  // Bottom sheet
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
    paddingTop: 12,
  },
  bottomSheetIndicator: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    position: 'absolute',
    top: -8,
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
  helpButton: {
    position: 'absolute',
    right: 36,
    padding: 8,
  },
  
  // Section styling
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 10,
    marginTop: 6,
  },
  requiredText: {
    color: '#F44336',
    fontSize: 16,
  },
  
  // Photo grid
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  photoContainer: {
    width: 90,
    height: 90,
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  photoThumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  removePhotoButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  addPhotoButton: {
    width: 90,
    height: 90,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderStyle: 'dashed',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: {
    marginTop: 4,
    color: '#2196F3',
    fontSize: 12,
  },
  
  // Comment input
  commentInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 10,
    height: 70,
    textAlignVertical: 'top',
    marginBottom: 16,
    fontSize: 14,
  },
  
  // Form buttons
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#9E9E9E',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 10,
  },
  submitButton: {
    flex: 1,
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#BDBDBD',
    opacity: 0.7,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
  
  // Show all button
  showAllButton: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    backgroundColor: '#2196F3',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  showAllButtonText: {
    color: 'white',
    marginLeft: 6,
    fontWeight: '600',
    fontSize: 14,
  },
  
  // Feedback modals
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  // Keep all other necessary styles...
  // ... existing code ...
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#F44336',
    fontSize: 16,
    textAlign: 'center',
    marginVertical: 20,
    lineHeight: 24,
  },
  retryButton: {
    backgroundColor: '#40B59F',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 25,
    elevation: 5,
  },
  retryButtonText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  allPointsModalView: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212121',
  },
  allPointsScrollView: {
    marginTop: 10,
  },
  feedbackCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  feedbackHeader: {
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  feedbackType: {
    color: '#333',
    fontWeight: '600',
    fontSize: 16,
  },
  featuresIconContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  featuresContainer: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  featuresList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9F7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    gap: 6,
  },
  featureText: {
    fontSize: 14,
    color: '#40B59F',
  },
  locationContainer: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  locationText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  coordinatesText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  commentContainer: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  commentText: {
    fontSize: 14,
    color: '#424242',
    lineHeight: 20,
  },
  imageContainer: {
    width: '100%',
    height: 180,
    position: 'relative',
  },
  feedbackImage: {
    width: '100%',
    height: '100%',
  },
  morePhotosIndicator: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  morePhotosText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  photoRequiredText: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  // Add the test button style
  testButton: {
    marginTop: 16,
    backgroundColor: '#9C27B0',
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  analyzingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(8px)',
  },
  analyzingContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
    width: '80%',
    maxWidth: 280,
  },
  photoAnalyzingContent: {
    backgroundColor: '#40B59F',
    padding: 24,
    borderRadius: 16,
    width: '85%',
    maxWidth: 300,
  },
  analyzingIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F5F9FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  photoAnalyzingIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#40B59F',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  analyzingText: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  photoAnalyzingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  progressBarContainer: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 2,
  },
  photoProgressBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  floorSelector: {
    marginBottom: 16,
  },
  floorButtonsContainer: {
    flexDirection: 'row',
    paddingVertical: 8,
    gap: 8,
  },
  floorButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  selectedFloorButton: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  floorButtonText: {
    fontSize: 14,
    color: '#424242',
    fontWeight: '500',
  },
  selectedFloorButtonText: {
    color: 'white',
  },
  buildingSelector: {
    marginBottom: 16,
  },
  buildingInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#F5F5F5',
  },
  buildingInputText: {
    fontSize: 14,
    color: '#424242',
  },
  placeholderText: {
    color: '#9E9E9E',
  },
  inputError: {
    borderColor: '#F44336',
  },
  errorText: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 4,
  },
  dropdownContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    maxHeight: 200,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  dropdownList: {
    maxHeight: 150,
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#424242',
  },
  customInputButton: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#F5F5F5',
  },
  customInputText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  floorText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  buildingText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
});

export default AccessibilityMap;

