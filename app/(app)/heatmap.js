"use client"

import { useState, useEffect, useRef } from "react"
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Animated,
  Easing,
  Modal,
  Image,
} from "react-native"
import MapView, { PROVIDER_DEFAULT, Marker } from "react-native-maps"
import * as Location from "expo-location"
import { Ionicons } from "@expo/vector-icons"
import axios from "axios"
import * as Notifications from "expo-notifications"
import { useAuth } from "../../context/authContext"
import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "../../firebaseConfig"
import AsyncStorage from "@react-native-async-storage/async-storage"
import Constants from "expo-constants"
import * as ImagePicker from "expo-image-picker"
import { getStorage, ref, getDownloadURL } from "firebase/storage"
import AreaSummaryModal from "./area-summary-modal"

// Check for environment configuration
const ENV = process.env.APP_ENV || Constants.expoConfig?.extra?.appEnvironment || "development"
const GEMINI_TIMEOUT_MS = process.env.GEMINI_TIMEOUT_MS ? Number.parseInt(process.env.GEMINI_TIMEOUT_MS, 10) : 30000 // Default 30 seconds
const USE_LOW_QUALITY_IMAGES = process.env.IMAGE_QUALITY === "low" || Platform.OS === "android"
const IS_TESTING = ENV === "testing" || process.env.GEMINI_DEBUG === "true"

// Add debug logging function
const debugLog = (message, ...args) => {
  if (IS_TESTING) {
    console.log(`[GEMINI-DEBUG] ${message}`, ...args)
  }
}

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

// Gemini API configuration
const GEMINI_API_KEY = Constants.expoConfig?.extra?.geminiApiKey || "AIzaSyB39VU33DtO7f9ZxmEtySX_5lgZT3Ary0k"
console.log("Using Gemini API key from:", Constants.expoConfig?.extra?.geminiApiKey ? "app.json" : "hardcoded value")

// Add direct Gemini API endpoint
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`
console.log("Environment:", ENV, "Using direct API calls to Gemini")

// Log environment settings for debug builds
if (IS_TESTING) {
  debugLog("Environment:", ENV)
  debugLog("Platform:", Platform.OS)
  debugLog("Gemini Timeout:", GEMINI_TIMEOUT_MS, "ms")
  debugLog("Using low quality images:", USE_LOW_QUALITY_IMAGES ? "YES" : "NO")
}

// Add these new constants at the top of the file after imports
const INDOOR_RADIUS = 20 // meters
const FLOOR_HEIGHT = 3 // meters per floor
const MAX_INDOOR_DISTANCE = 50 // meters
const AREA_AGGREGATION_RADIUS = 100 // meters for area-based aggregation

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
)

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
)

const FilterButton = ({ icon, label, isActive, onPress }) => (
  <TouchableOpacity style={[styles.filterButton, isActive && styles.activeFilter]} onPress={onPress}>
    <Ionicons name={icon} size={18} color={isActive ? "white" : "#1976D2"} />
    <Text style={[styles.filterText, isActive && styles.activeFilterText]}>{label}</Text>
  </TouchableOpacity>
)

// Add new state for images
const [selectedImages, setSelectedImages] = useState([])
const [imageViewerVisible, setImageViewerVisible] = useState(false)
const [currentImageIndex, setCurrentImageIndex] = useState(0)

// Add image picker function
const pickImage = async () => {
  try {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync()
    
    if (!permissionResult.granted) {
      Alert.alert("Permission Required", "Please allow access to your photo library to add images.")
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      allowsMultipleSelection: true,
      maxSelected: 5,
    })

    if (!result.canceled) {
      const newImages = result.assets.map(asset => asset.uri)
      setSelectedImages(prevImages => [...prevImages, ...newImages])
    }
  } catch (error) {
    console.error("Error picking image:", error)
    Alert.alert("Error", "Failed to pick image. Please try again.")
  }
}

// Add camera function
const takePhoto = async () => {
  try {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync()
    
    if (!permissionResult.granted) {
      Alert.alert("Permission Required", "Please allow access to your camera to take photos.")
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    })

    if (!result.canceled) {
      setSelectedImages(prevImages => [...prevImages, result.assets[0].uri])
    }
  } catch (error) {
    console.error("Error taking photo:", error)
    Alert.alert("Error", "Failed to take photo. Please try again.")
  }
}

// Add image viewer component
const ImageViewer = ({ images, visible, onClose, initialIndex = 0 }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)

  if (!visible || !images || images.length === 0) return null

  return (
    <Modal visible={visible} transparent={true} onRequestClose={onClose}>
      <View style={styles.imageViewerContainer}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={24} color="white" />
        </TouchableOpacity>
        
        <View style={styles.imageContainer}>
          {loadingImages ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : (
            <Image
              source={{ uri: images[currentIndex] }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          )}
        </View>
        
        {images.length > 1 && (
          <View style={styles.navigationContainer}>
            <TouchableOpacity 
              style={styles.navButton}
              onPress={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
            >
              <Ionicons name="chevron-back" size={24} color="white" />
            </TouchableOpacity>
            
            <Text style={styles.imageCounter}>{`${currentIndex + 1} / ${images.length}`}</Text>
            
            <TouchableOpacity 
              style={styles.navButton}
              onPress={() => setCurrentIndex(prev => Math.min(images.length - 1, prev + 1))}
              disabled={currentIndex === images.length - 1}
            >
              <Ionicons name="chevron-forward" size={24} color="white" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  )
}

// Add this new component after the imports and before the AccessibilityMap component
const AnalyzingAnimation = ({ visible, isPhotoAnalysis = false }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current
  const rotateAnim = useRef(new Animated.Value(0)).current
  const progressAnim = useRef(new Animated.Value(0)).current
  const fadeAnim = useRef(new Animated.Value(0)).current
  const [messageIndex, setMessageIndex] = useState(0)

  // Simplified messages for a cleaner look
  const generalMessages = [
    "Analyzing accessibility features...",
    "Detecting accessibility elements...",
    "Almost done...",
  ]

  const photoAnalysisMessages = [
    "Processing image...",
    "Analyzing features...",
    "Detecting ramps & pathways...",
    "Identifying elevators...",
    "Almost complete...",
  ]

  const messages = isPhotoAnalysis ? photoAnalysisMessages : generalMessages

  useEffect(() => {
    if (visible) {
      // Reset animations when becoming visible
      pulseAnim.setValue(1)
      rotateAnim.setValue(0)
      progressAnim.setValue(0)
      fadeAnim.setValue(0)

      // Fade in animation
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.ease,
        useNativeDriver: true,
      }).start()

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
        ]),
      )

      // Smooth rotating animation
      const rotateAnimation = Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: isPhotoAnalysis ? 3000 : 4000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      )

      // Progress bar animation
      const progressAnimation = Animated.timing(progressAnim, {
        toValue: 1,
        duration: isPhotoAnalysis ? 12000 : 6000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      })

      pulseAnimation.start()
      rotateAnimation.start()
      progressAnimation.start()

      // Rotate through messages
      const messageInterval = setInterval(() => {
        setMessageIndex((prev) => (prev + 1) % messages.length)
      }, 2200)

      return () => {
        clearInterval(messageInterval)
        pulseAnimation.stop()
        rotateAnimation.stop()
        progressAnimation.stop()

        // Fade out on cleanup
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start()
      }
    }
  }, [visible, isPhotoAnalysis])

  if (!visible) return null

  // Create a rotation interpolation for the spinner
  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  })

  return (
    <Animated.View style={[styles.analyzingContainer, { opacity: fadeAnim }]}>
      <View style={[styles.analyzingContent, isPhotoAnalysis && styles.photoAnalyzingContent]}>
        {/* Icon container with clean shadow */}
        <Animated.View
          style={[
            isPhotoAnalysis ? styles.photoAnalyzingIconContainer : styles.analyzingIconContainer,
            {
              transform: [{ scale: pulseAnim }, { rotate: spin }],
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
        <Animated.Text style={[styles.analyzingText, isPhotoAnalysis && styles.photoAnalyzingText]}>
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
                  outputRange: ["5%", "100%"],
                }),
              },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  )
}

const AccessibilityMap = () => {
  // State management
  const [location, setLocation] = useState(null)
  const [feedbacks, setFeedbacks] = useState([])
  const [addingFeedback, setAddingFeedback] = useState(false)
  const [feedbackType, setFeedbackType] = useState(null)
  const [comment, setComment] = useState("")
  const [selectedFilters, setSelectedFilters] = useState({
    wheelchairRamps: true,
    elevators: true,
    chairs: true,
    widePathways: true,
    pwdRestrooms: true,
  })
  const [activeFilters, setActiveFilters] = useState([])
  const [selectedFeedback, setSelectedFeedback] = useState(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedbackData, setFeedbackData] = useState({})
  const [panoramaImage, setPanoramaImage] = useState(null)
  const { user } = useAuth()
  const [zoomLevel, setZoomLevel] = useState(15)
  const [showAllPointsModal, setShowAllPointsModal] = useState(false)
  const [mapError, setMapError] = useState(null)
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false)
  const [helpModalVisible, setHelpModalVisible] = useState(false)
  const [accessibilityFilters, setAccessibilityFilters] = useState({
    accessible: true,
    partially: true,
    inaccessible: true,
  })

  // Add new state for area summary
  const [areaSummaryVisible, setAreaSummaryVisible] = useState(false)
  const [selectedAreaData, setSelectedAreaData] = useState(null)
  const [selectedAreaLocation, setSelectedAreaLocation] = useState("")

  // Add new state for API verification
  const [geminiApiVerified, setGeminiApiVerified] = useState(false)
  const [apiVerificationAttempted, setApiVerificationAttempted] = useState(false)

  // Add the missing ref
  const locationWatchRef = useRef(null)
  const isMounted = useRef(true)

  // Add new state for feedback validation
  const [feedbackValidation, setFeedbackValidation] = useState({
    isValid: false,
    confidence: 0,
    reasons: [],
  })

  // Add these new state variables for collapsible filters
  const [filtersCollapsed, setFiltersCollapsed] = useState(true) // Start collapsed
  const filterContainerHeight = useRef(new Animated.Value(0)).current // Start with 0 height

  // Add new state for submission lock
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Add state for Firebase images
  const [feedbackImages, setFeedbackImages] = useState({})
  const [loadingImages, setLoadingImages] = useState(false)

  // Add function to fetch images for a feedback
  const fetchFeedbackImages = async (feedback) => {
    if (!feedback.images || feedbackImages[feedback.id]) return
    
    try {
      setLoadingImages(true)
      const storage = getStorage()
      const imageUrls = []

      for (const imagePath of feedback.images) {
        try {
          const imageRef = ref(storage, imagePath)
          const url = await getDownloadURL(imageRef)
          imageUrls.push(url)
        } catch (error) {
          console.error(`Error fetching image ${imagePath}:`, error)
        }
      }

      setFeedbackImages(prev => ({
        ...prev,
        [feedback.id]: imageUrls
      }))
    } catch (error) {
      console.error("Error fetching feedback images:", error)
    } finally {
      setLoadingImages(false)
    }
  }

  // Update handleMarkerPress function
  const handleMarkerPress = async (feedback) => {
    try {
      console.log("🎯 Marker pressed, feedback data:", JSON.stringify(feedback, null, 2))
      console.log("Images in feedback:", feedback.images)
      
      // Find all feedbacks within the aggregation radius
      const nearbyFeedbacks = feedbacks.filter((f) => {
        const distance = calculateDistance(feedback.coordinate, f.coordinate)
        return distance <= AREA_AGGREGATION_RADIUS
      })

      console.log(`📊 Found ${nearbyFeedbacks.length} feedbacks in area`)
      console.log("Nearby feedbacks data:", JSON.stringify(nearbyFeedbacks.map(f => ({
        id: f.id,
        images: f.images,
        type: f.type
      })), null, 2))

      // Get location name for the area
      let locationName = "Loading location..."
      try {
        locationName = await getLocationName(feedback.coordinate.latitude, feedback.coordinate.longitude)
      } catch (error) {
        console.error("Error getting location name:", error)
        locationName = `Area near ${feedback.coordinate.latitude.toFixed(4)}, ${feedback.coordinate.longitude.toFixed(4)}`
      }

      // Prepare area data
      const areaData = {
        centerPoint: feedback.coordinate,
        feedbacks: nearbyFeedbacks,
        radius: AREA_AGGREGATION_RADIUS,
      }

      // Set state and show modal
      setSelectedAreaLocation(locationName)
      setSelectedAreaData(areaData)
      setAreaSummaryVisible(true)
      
      console.log("Modal state:", {
        areaSummaryVisible: true,
        hasData: !!areaData,
        feedbackCount: nearbyFeedbacks.length,
        locationName,
        feedbacksWithImages: nearbyFeedbacks.filter(f => f.images && f.images.length > 0).length
      })
    } catch (error) {
      console.error("Error aggregating area data:", error)
      Alert.alert("Error", "Failed to load area data")
    }
  }

  // Add this new function to verify Gemini API connectivity
  const verifyGeminiApiConnectivity = async () => {
    if (apiVerificationAttempted) return

    try {
      console.log("🔄 Verifying Gemini API connectivity...")

      // Mark as attempted - but we'll set verified based on success
      setApiVerificationAttempted(true)

      // Use direct axios call for API verification - more reliable
      const response = await axios({
        method: "post",
        url: GEMINI_URL,
        headers: {
          "Content-Type": "application/json",
        },
        data: {
          contents: [
            {
              parts: [{ text: "Respond with just the word 'connected'" }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 10,
          },
        },
        timeout: 10000,
      })

      console.log("✅ Gemini API connectivity verified successfully!")

      // Successfully got a response, so we can mark as verified
      setGeminiApiVerified(true)
    } catch (error) {
      console.error("❌ Gemini API connectivity verification failed:", error.message)

      // Try alternative verification method using models endpoint
      try {
        console.log("🔄 Trying alternative API verification...")
        const modelsResponse = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
          { timeout: 5000 },
        )

        if (modelsResponse.status === 200) {
          console.log("✅ Alternative API verification successful!")
          setGeminiApiVerified(true)
          return
        }
      } catch (altError) {
        console.error("❌ Alternative verification also failed:", altError.message)
      }

      // Show more detailed error message
      Alert.alert(
        "API Connection Issue",
        `There might be issues connecting to our image recognition service. Photos may not be properly analyzed.\n\n` +
          `Technical details:\n` +
          `• Environment: ${ENV}\n` +
          `• API Key: ${GEMINI_API_KEY ? "Available" : "Missing"}\n` +
          `• Error: ${error.message}\n\n` +
          `Please check your internet connection or try again later.`,
        [
          {
            text: "Retry Connection",
            onPress: () => {
              setApiVerificationAttempted(false)
              setTimeout(() => verifyGeminiApiConnectivity(), 1000)
            },
          },
          { text: "Continue Anyway" },
        ],
      )
    }
  }

  // Add API verification check on component mount
  useEffect(() => {
    // For development environment, we'll skip the verification or force success
    if (ENV === "development") {
      console.log("🛠️ Development environment detected - forcing API verification success")
      setApiVerificationAttempted(true)
      setGeminiApiVerified(true)
    } else {
      // For production, do the actual verification
      verifyGeminiApiConnectivity()
    }
  }, [])

  // Add function to toggle accessibility filters
  const toggleAccessibilityFilter = (type) => {
    setAccessibilityFilters((prev) => ({
      ...prev,
      [type]: !prev[type],
    }))
  }

  // Add function to toggle filters visibility
  const toggleFiltersCollapsed = () => {
    const toValue = filtersCollapsed ? 1 : 0
    Animated.timing(filterContainerHeight, {
      toValue,
      duration: 300,
      useNativeDriver: false,
      easing: Easing.inOut(Easing.ease),
    }).start()
    setFiltersCollapsed(!filtersCollapsed)
  }

  // Define the AccessibilityTypeFilter component
  const AccessibilityTypeFilter = () => (
    <Animated.View
      style={[
        styles.accessibilityFilterContainer,
        {
          height: filterContainerHeight.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 220],
          }),
          opacity: filterContainerHeight,
          overflow: "hidden",
          marginTop: 8,
        },
      ]}
    >
      <Text style={styles.filterTitle}>Filter Features</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.accessibilityFilterButtons}>
        <TouchableOpacity
          style={[
            styles.accessibilityFilterButton,
            selectedFilters.wheelchairRamps && styles.activeAccessibilityFilter,
          ]}
          onPress={() => toggleAddFilter("wheelchairRamps")}
        >
          <View style={styles.filterIconContainer}>
            <Ionicons
              name="accessibility-outline"
              size={16}
              color={selectedFilters.wheelchairRamps ? "rgba(76, 175, 80, 0.9)" : "rgba(117, 117, 117, 0.7)"}
            />
          </View>
          <Text style={[styles.filterButtonText, selectedFilters.wheelchairRamps && styles.activeFilterText]}>
            Ramps
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.accessibilityFilterButton, selectedFilters.elevators && styles.activeAccessibilityFilter]}
          onPress={() => toggleAddFilter("elevators")}
        >
          <View style={styles.filterIconContainer}>
            <Ionicons
              name="arrow-up-outline"
              size={16}
              color={selectedFilters.elevators ? "rgba(33, 150, 243, 0.9)" : "rgba(117, 117, 117, 0.7)"}
            />
          </View>
          <Text style={[styles.filterButtonText, selectedFilters.elevators && styles.activeFilterText]}>Elevators</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.accessibilityFilterButton, selectedFilters.widePathways && styles.activeAccessibilityFilter]}
          onPress={() => toggleAddFilter("widePathways")}
        >
          <View style={styles.filterIconContainer}>
            <Ionicons
              name="resize-outline"
              size={16}
              color={selectedFilters.widePathways ? "rgba(255, 152, 0, 0.9)" : "rgba(117, 117, 117, 0.7)"}
            />
          </View>
          <Text style={[styles.filterButtonText, selectedFilters.widePathways && styles.activeFilterText]}>
            Pathways
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.accessibilityFilterButton, selectedFilters.pwdRestrooms && styles.activeAccessibilityFilter]}
          onPress={() => toggleAddFilter("pwdRestrooms")}
        >
          <View style={styles.filterIconContainer}>
            <Ionicons
              name="water-outline"
              size={16}
              color={selectedFilters.pwdRestrooms ? "rgba(156, 39, 176, 0.9)" : "rgba(117, 117, 117, 0.7)"}
            />
          </View>
          <Text style={[styles.filterButtonText, selectedFilters.pwdRestrooms && styles.activeFilterText]}>
            PWD Restrooms
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Animated.View>
  )

  // Replace FilterToggleButton component
  const FilterToggleButton = () => (
    <TouchableOpacity style={styles.filterToggleButton} onPress={toggleFiltersCollapsed}>
      <Ionicons name={filtersCollapsed ? "funnel" : "funnel-outline"} size={16} color="white" />
      <Text style={styles.filterToggleText}>{filtersCollapsed ? "Filter" : "Hide"}</Text>
    </TouchableOpacity>
  )

  // Initialize location and permissions with improved error handling
  useEffect(() => {
    const initializeLocation = async () => {
      try {
        console.log("Starting location initialization...")

        // Check if we already have permission status stored
        const storedPermissions = await AsyncStorage.getItem("permissionsStatus")
        let hasLocationPermission = false

        if (storedPermissions) {
          const parsedPermissions = JSON.parse(storedPermissions)
          hasLocationPermission = parsedPermissions.location === true
        }

        // Only request permission if we don't already have it
        if (!hasLocationPermission) {
          console.log("Requesting location permission...")
          const { status } = await Location.requestForegroundPermissionsAsync()
          if (status !== "granted") {
            console.log("Location permission denied")
            setMapError("Location permission not granted. Please enable location permissions in your device settings.")
            return
          }

          // Update stored permissions
          const updatedPermissions = storedPermissions
            ? { ...JSON.parse(storedPermissions), location: true }
            : { location: true }
          await AsyncStorage.setItem("permissionsStatus", JSON.stringify(updatedPermissions))
        }

        // Check if location services are enabled
        try {
          const locationEnabled = await Location.hasServicesEnabledAsync()
          console.log("Location services enabled:", locationEnabled)

          if (!locationEnabled) {
            setMapError("Location services are disabled. Please enable location services in your device settings.")
            return
          }
        } catch (serviceError) {
          console.warn("Error checking location services:", serviceError)
          // Continue anyway since services might actually be enabled
          // The hasServicesEnabledAsync API can be unreliable on some devices
        }

        // Try to get location with multiple attempts if needed
        console.log("Getting current position...")
        let currentLocation

        try {
          // First try with high accuracy but short timeout
          currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
            timeout: 5000,
          })
        } catch (highAccuracyError) {
          console.warn("High accuracy location failed, trying low accuracy:", highAccuracyError)

          try {
            // Fall back to low accuracy with longer timeout
            currentLocation = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
              timeout: 10000,
            })
          } catch (lowAccuracyError) {
            console.error("Low accuracy location also failed:", lowAccuracyError)
            throw new Error("Could not get location after multiple attempts")
          }
        }

        if (!currentLocation) {
          throw new Error("Location is null after attempts")
        }

        console.log("Location obtained successfully")

        if (isMounted.current) {
          setLocation({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          })
        }

        // Start watching location changes
        console.log("Starting location watch...")
        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (location) => {
            if (isMounted.current) {
              setLocation((prev) => ({
                ...prev,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }))
            }
          },
        )

        console.log("Location initialization complete")
      } catch (error) {
        console.error("Error initializing location:", error)

        // More specific error messages
        if (error.message && error.message.toLowerCase().includes("location is unavailable")) {
          setMapError(
            "Location services may be disabled. Please verify your device location settings are enabled and try again.",
          )
        } else if (error.message && error.message.toLowerCase().includes("timeout")) {
          setMapError("Location request timed out. Please check if you have a GPS signal and try again.")
        } else if (error.message && error.message.toLowerCase().includes("denied")) {
          setMapError(
            "Location permission denied. Please enable location permissions for this app in your device settings.",
          )
        } else {
          setMapError(
            `${error.message || "Failed to initialize location"}. Please check your device settings and try again.`,
          )
        }
      }
    }

    initializeLocation()

    return () => {
      isMounted.current = false
      if (locationWatchRef.current) {
        locationWatchRef.current.remove()
      }
    }
  }, [])

  // Calculate distance between two coordinates in meters
  const calculateDistance = (coord1, coord2) => {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = (coord1.latitude * Math.PI) / 180
    const φ2 = (coord2.latitude * Math.PI) / 180
    const Δφ = ((coord2.latitude - coord1.latitude) * Math.PI) / 180
    const Δλ = ((coord2.longitude - coord1.longitude) * Math.PI) / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const distance = R * c // This is already in meters

    return distance
  }

  // Update the fetchInitialFeedback function
  const fetchInitialFeedback = async () => {
    try {
      setLoading(true)

      const feedbackRef = collection(db, "accessibility_feedback")
      const q = query(feedbackRef, where("status", "==", "approved"))

      const querySnapshot = await getDocs(q)

      const fetchedFeedback = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      if (isMounted.current) {
        console.log("Fetched feedback count:", fetchedFeedback.length)
        setFeedbacks(fetchedFeedback)

        // Create heatmap points for each type
        const heatmapPoints = {
          accessible: [],
          partially: [],
          inaccessible: [],
        }

        fetchedFeedback.forEach((data) => {
          if (data.coordinate && data.type) {
            const point = createHeatmapPoint(data.coordinate, data.type, data.floor || null)

            heatmapPoints[data.type].push(point)
          }
        })

        console.log("Points by type:", {
          accessible: heatmapPoints.accessible.length,
          partially: heatmapPoints.partially.length,
          inaccessible: heatmapPoints.inaccessible.length,
        })

        // We don't need heatmap data anymore, but we'll keep the points data for reference
        setFeedbackData(heatmapPoints)

        // Notify user that map data has been updated
        if (
          heatmapPoints.accessible.length > 0 ||
          heatmapPoints.partially.length > 0 ||
          heatmapPoints.inaccessible.length > 0
        ) {
          const totalPoints =
            heatmapPoints.accessible.length + heatmapPoints.partially.length + heatmapPoints.inaccessible.length

          // Only show notification if we have points and not initial load
          if (totalPoints > 0 && !isMounted.current) {
            showLocalNotification("Accessibility Map Updated", `Map refreshed with ${totalPoints} accessibility points`)
          }
        }
      }
    } catch (error) {
      console.error("Error fetching feedback:", error)
      Alert.alert("Error", "Failed to load accessibility data")
    } finally {
      if (isMounted.current) {
        setLoading(false)
      }
    }
  }

  // Add useEffect to fetch data when component mounts
  useEffect(() => {
    fetchInitialFeedback()
  }, [])

  // Update the createHeatmapPoint function
  const createHeatmapPoint = (coordinate, type, floor = null) => ({
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    weight: type === "accessible" ? 1.0 : type === "partially" ? 0.5 : 0.2,
    intensity: 1.0,
    floor: floor,
    radius: INDOOR_RADIUS,
  })

  // Get location name for display
  const getLocationName = async (latitude, longitude) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        {
          headers: {
            "Accept-Language": "en",
            "User-Agent": "Gabay-App",
          },
        },
      )

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const text = await response.text()
      try {
        const data = JSON.parse(text)
        if (data && data.display_name) {
          return data.display_name
        }
        return "Unknown Location"
      } catch (parseError) {
        console.error("Error parsing JSON:", parseError)
        return "Unknown Location"
      }
    } catch (error) {
      console.error("Error getting location name:", error)
      return "Unknown Location"
    }
  }

  // Update shouldDisplayFeedback function to filter based on features
  const shouldDisplayFeedback = (feedback) => {
    // Check if feedback has features
    if (!feedback.features || feedback.features.length === 0) {
      return false
    }

    // Check if any selected feature filter matches this feedback
    const hasSelectedFilters = Object.entries(selectedFilters).some(([key, value]) => value === true)

    if (!hasSelectedFilters) {
      // If no filters selected, show all feedbacks
      return true
    }

    // Show only feedbacks that have at least one of the selected features
    return feedback.features.some((feature) => selectedFilters[feature])
  }

  // Toggle a filter for adding feedback
  const toggleAddFilter = (filter) => {
    setSelectedFilters({
      ...selectedFilters,
      [filter]: !selectedFilters[filter],
    })
  }

  // Add function to schedule a local notification
  const showLocalNotification = async (title, body) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: title,
          body: body,
          data: { data: "goes here" },
        },
        trigger: null, // null means show immediately
      })
    } catch (error) {
      console.error("Error showing notification:", error)
    }
  }

  // Update state variables
  const [selectedFloor, setSelectedFloor] = useState("G")
  const [building, setBuilding] = useState("")
  const [showBuildingDropdown, setShowBuildingDropdown] = useState(false)
  const [validationErrors, setValidationErrors] = useState({})

  // Add common building/section options
  const commonBuildings = [
    "Main Building",
    "North Wing",
    "South Wing",
    "East Wing",
    "West Wing",
    "Food Court",
    "Entertainment Area",
    "Shopping Area",
    "Parking Building",
    "Office Tower",
    "Residential Tower",
    "Other",
  ]

  // Simplified component structure - keeping only essential functions for the enhanced clickable heatmap
  if (!location) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#40B59F" />
        <Text style={styles.loadingText}>Loading map...</Text>
        {mapError && <Text style={styles.errorText}>{mapError}</Text>}
      </View>
    )
  }

  if (mapError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="location-off" size={48} color="#F44336" />
          <Text style={styles.errorText}>{mapError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => window.location.reload()}>
            <Ionicons name="refresh" size={20} color="white" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

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
        onMapReady={() => {
          console.log("Map is ready")
          fetchInitialFeedback()
        }}
        onError={(error) => {
          console.error("Map error:", error)
          setMapError(error.message || "Failed to load map")
        }}
      >
        {/* Map markers */}
        {feedbacks.filter(shouldDisplayFeedback).map((feedback) => {
          if (feedback.features && feedback.features.length > 0) {
            return feedback.features.map((feature, index) => {
              let iconName
              let iconColor

              switch (feature) {
                case "wheelchairRamps":
                  iconName = "accessibility-outline"
                  iconColor = "rgba(76, 175, 80, 0.85)"
                  break
                case "elevators":
                  iconName = "arrow-up-outline"
                  iconColor = "rgba(33, 150, 243, 0.85)"
                  break
                case "widePathways":
                  iconName = "resize-outline"
                  iconColor = "rgba(255, 152, 0, 0.85)"
                  break
                case "pwdRestrooms":
                  iconName = "water-outline"
                  iconColor = "rgba(156, 39, 176, 0.85)"
                  break
                default:
                  iconName = "location-outline"
                  iconColor = "rgba(158, 158, 158, 0.85)"
              }

              const offset = {
                latOffset: 0.00004 * (index % 2 ? 1 : -1),
                lngOffset: 0.00004 * (index % 4 < 2 ? 1 : -1),
              }

              return (
                <Marker
                  key={`${feedback.id}-${feature}-${index}`}
                  coordinate={{
                    latitude: feedback.coordinate.latitude + offset.latOffset,
                    longitude: feedback.coordinate.longitude + offset.lngOffset,
                  }}
                  onPress={() => handleMarkerPress(feedback)}
                >
                  <View style={styles.markerContainer}>
                    <View style={[styles.markerIconContainer, { backgroundColor: iconColor }]}>
                      <Ionicons name={iconName} size={16} color="white" />
                    </View>
                  </View>
                </Marker>
              )
            })
          }

          return (
            <Marker key={feedback.id} coordinate={feedback.coordinate} onPress={() => handleMarkerPress(feedback)}>
              <View style={styles.markerContainer}>
                <View style={[styles.markerIconContainer, { backgroundColor: "#9E9E9E" }]}>
                  <Ionicons name="location-outline" size={16} color="white" />
                </View>
              </View>
            </Marker>
          )
        })}
      </MapView>

      <Legend />
      <View style={styles.filterControlsContainer}>
        <FilterToggleButton />
        {AccessibilityTypeFilter()}
      </View>

      {loading && <AnalyzingAnimation visible={loading} />}

      {/* Area Summary Modal */}
      <AreaSummaryModal
        visible={areaSummaryVisible}
        onClose={() => {
          console.log("Closing modal")
          setAreaSummaryVisible(false)
        }}
        areaData={selectedAreaData}
        locationName={selectedAreaLocation}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  map: {
    flex: 1,
  },
  legendContainer: {
    position: "absolute",
    top: 16,
    right: 12,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 10,
    padding: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
    minWidth: 90,
    zIndex: 5,
  },
  legendHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: "500",
    color: "#444",
    marginLeft: 4,
  },
  legendItems: {
    gap: 3,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendIconWrapper: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  legendText: {
    fontSize: 10,
    color: "#555",
  },

  // Filter controls
  filterControlsContainer: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 10,
    width: 160,
  },
  filterToggleButton: {
    backgroundColor: "rgba(33, 150, 243, 0.9)",
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  filterToggleText: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 5,
  },
  accessibilityFilterContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 12,
    padding: 10,
    paddingBottom: 12,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 4,
  },
  filterTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: "#555",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  accessibilityFilterButtons: {
    flexDirection: "column",
    gap: 10,
  },
  accessibilityFilterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    gap: 8,
    marginBottom: 2,
  },
  activeAccessibilityFilter: {
    backgroundColor: "rgba(227, 242, 253, 0.8)",
    borderColor: "#BBDEFB",
  },
  filterIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#555",
    flex: 1,
  },
  activeFilterText: {
    color: "#1976D2",
    fontWeight: "600",
  },

  // Marker styles
  markerContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
  },
  markerIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#2196F3",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },

  // Analyzing animation styles
  analyzingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    backdropFilter: "blur(8px)",
  },
  analyzingContent: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
    width: "80%",
    maxWidth: 280,
  },
  photoAnalyzingContent: {
    backgroundColor: "#40B59F",
    padding: 24,
    borderRadius: 16,
    width: "85%",
    maxWidth: 300,
  },
  analyzingIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#F5F9FE",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
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
    backgroundColor: "#40B59F",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.8)",
  },
  analyzingText: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    marginBottom: 20,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  photoAnalyzingText: {
    color: "white",
    fontSize: 16,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  progressBarContainer: {
    width: "100%",
    height: 4,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#2196F3",
    borderRadius: 2,
  },
  photoProgressBar: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  imageViewerContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageContainer: {
    width: "100%",
    height: "80%",
  },
  fullImage: {
    width: "100%",
    height: "100%",
  },
  navigationContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "absolute",
    bottom: 40,
    width: "100%",
    paddingHorizontal: 20,
  },
  navButton: {
    padding: 10,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 20,
  },
  imageCounter: {
    color: "white",
    fontSize: 16,
  },

  // Loading and error states
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    color: "#F44336",
    fontSize: 16,
    textAlign: "center",
    marginVertical: 20,
    lineHeight: 24,
  },
  retryButton: {
    backgroundColor: "#40B59F",
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 25,
    elevation: 5,
  },
  retryButtonText: {
    color: "white",
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "600",
  },
})

export default AccessibilityMap
