import React, { useState, useEffect, useRef } from "react";
import {
  View,
  TextInput,
  FlatList,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  Linking,
  Platform,
  Alert,
} from "react-native";
import MapView, { Marker, Polyline, Callout } from "react-native-maps";
import * as Location from "expo-location";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { collection, query, where, orderBy, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/authContext';
import { router } from 'expo-router';

// Updated Jeepney Routes in Bacolod with accurate routes and landmarks
const JEEPNEY_ROUTES = [
  {
    name: "Bata - Central Market",
    route: "Bata → Lacson St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Bata Terminal",
      "Central Market",
      // Hospitals
      "Riverside Medical Center",
      "Dr. Pablo O. Torre Memorial Hospital",
      // Schools
      "University of St. La Salle",
      "La Consolacion College",
      "St. John's Institute",
      // Malls & Commercial
      "888 Chinatown Square",
      "Gaisano City",
      // Barangays
      "Barangay 1",
      "Barangay 14",
      "Barangay 19",
      "Barangay Bata"
    ],
    color: "#FF0000" // Red
  },
  {
    name: "Mandalagan - Central",
    route: "Mandalagan → Lacson St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Mandalagan Terminal",
      "Central Market",
      // Hospitals
      "South Bacolod General Hospital",
      // Schools
      "St. Scholastica's Academy",
      "Jack and Jill School",
      // Malls & Commercial
      "Robinsons Place Bacolod",
      "Ayala Malls Capitol Central",
      "SM City Bacolod",
      // Government
      "Provincial Capitol",
      "Bacolod City Hall",
      // Barangays
      "Barangay Mandalagan",
      "Barangay Villamonte",
      "Barangay 39"
    ],
    color: "#0000FF" // Blue
  },
  {
    name: "Fortune - Central",
    route: "Fortune Towne → Burgos St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Fortune Town Terminal",
      "Central Market",
      "Burgos Market",
      // Hospitals
      "Bacolod Adventist Medical Center",
      "Queens of Mercy Hospital",
      // Schools
      "STI West Negros University",
      "Riverside College",
      // Commercial Areas
      "Burgos Public Market",
      // Barangays
      "Barangay Estefania",
      "Barangay Granada",
      "Barangay 8",
      "Barangay 10"
    ],
    color: "#008000" // Green
  },
  {
    name: "Alijis - Central",
    route: "Alijis → Araneta St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Alijis Terminal",
      "Central Market",
      // Government
      "Bacolod City Government Center",
      "BAYS Center",
      // Schools
      "Carlos Hilado Memorial State College",
      "ETCS School",
      // Hospitals
      "South Bacolod General Hospital",
      // Barangays
      "Barangay Alijis",
      "Barangay Taculing",
      "Barangay 35"
    ],
    color: "#FFA500" // Orange
  },
  {
    name: "Shopping - Mandalagan",
    route: "Shopping → Lacson St. → Mandalagan",
    landmarks: [
      // Commercial Areas
      "888 Shopping Center",
      "Gaisano City",
      "Robinsons Place Bacolod",
      "SM City Bacolod",
      // Schools
      "University of St. La Salle",
      "La Consolacion College",
      // Hospitals
      "Riverside Medical Center",
      // Barangays
      "Barangay 25",
      "Barangay Villamonte",
      "Barangay Mandalagan"
    ],
    color: "#800080" // Purple
  },
  {
    name: "Sum-ag - Central",
    route: "Sum-ag → Araneta St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Sum-ag Terminal",
      "Central Market",
      // Schools
      "Sum-ag National High School",
      "Don Bosco Technical Institute",
      // Hospitals
      "South Bacolod General Hospital",
      // Barangays
      "Barangay Sum-ag",
      "Barangay Pahanocoy",
      "Barangay Singcang-Airport"
    ],
    color: "#A52A2A" // Brown
  },
  {
    name: "Granada - Central",
    route: "Granada → Burgos St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Granada Terminal",
      "Central Market",
      // Schools
      "Living Stones International School",
      // Tourist Spots
      "Campuestohan Highland Resort",
      // Barangays
      "Barangay Granada",
      "Barangay Alangilan",
      "Barangay 8"
    ],
    color: "#FF4500" // OrangeRed
  },
  {
    name: "Banago - Central",
    route: "Banago → San Juan St. → Central Market",
    landmarks: [
      // Terminals & Markets
      "Banago Terminal",
      "Central Market",
      // Port
      "Banago Wharf",
      "BREDCO Port",
      // Schools
      "VMA Global College",
      // Government
      "City Health Office",
      // Barangays
      "Barangay Banago",
      "Barangay 2",
      "Barangay 12"
    ],
    color: "#4682B4" // SteelBlue
  }
];

// Add ap jeepney stop coordinates
const JEEPNEY_STOPS = {
  // Terminals
  "Bata Terminal": { latitude: 10.6935, longitude: 122.9465 },
  "Central Market Terminal": { latitude: 10.6712, longitude: 122.9465 },
  "Mandalagan Terminal": { latitude: 10.6832, longitude: 122.9472 },
  "Fortune Town Terminal": { latitude: 10.6789, longitude: 122.9521 },
  "Sum-ag Terminal": { latitude: 10.6389, longitude: 122.9479 },
  "Granada Terminal": { latitude: 10.6756, longitude: 122.9698 },
  "Banago Terminal": { latitude: 10.6651, longitude: 122.9456 },
  
  // Markets
  "Central Market": { latitude: 10.6712, longitude: 122.9465 },
  "Burgos Market": { latitude: 10.6725, longitude: 122.9512 },
  
  // Malls
  "SM City Bacolod": { latitude: 10.6707, longitude: 122.9444 },
  "Robinsons Place": { latitude: 10.6784, longitude: 122.9476 },
  "888 Chinatown Square": { latitude: 10.6725, longitude: 122.9469 },
  "Ayala Malls Capitol Central": { latitude: 10.6761, longitude: 122.9473 },
  
  // Hospitals
  "Riverside Medical Center": { latitude: 10.6817, longitude: 122.9467 },
  "Dr. Pablo O. Torre Memorial Hospital": { latitude: 10.6795, longitude: 122.9466 },
  "South Bacolod General Hospital": { latitude: 10.6640, longitude: 122.9475 },
  "Bacolod Adventist Medical Center": { latitude: 10.6728, longitude: 122.9521 },
  
  // Schools
  "University of St. La Salle": { latitude: 10.6828, longitude: 122.9463 },
  "La Consolacion College": { latitude: 10.6751, longitude: 122.9467 },
  "STI West Negros University": { latitude: 10.6725, longitude: 122.9521 },
  "Carlos Hilado Memorial State College": { latitude: 10.6640, longitude: 122.9521 },
  
  // Government Offices
  "Provincial Capitol": { latitude: 10.6761, longitude: 122.9473 },
  "Bacolod City Government Center": { latitude: 10.6640, longitude: 122.9521 },
  "City Health Office": { latitude: 10.6712, longitude: 122.9456 }
};

// Add landmark details for better route planning
const LANDMARK_DETAILS = {
  // Hospitals
  "Riverside Medical Center": {
    type: "hospital",
    routes: ["Bata - Central", "Shopping - Mandalagan"],
    emergency: true
  },
  "Dr. Pablo O. Torre Memorial Hospital": {
    type: "hospital",
    routes: ["Bata - Central"],
    emergency: true
  },
  
  // Schools
  "University of St. La Salle": {
    type: "school",
    routes: ["Bata - Central", "Shopping - Mandalagan"],
    peakHours: ["6:00-8:00", "15:00-17:00"]
  },
  
  // Malls
  "SM City Bacolod": {
    type: "mall",
    routes: ["Mandalagan - Central", "Shopping - Mandalagan"],
    operatingHours: "10:00-21:00"
  },
  
  // Markets
  "Central Market": {
    type: "market",
    routes: ["all"],
    peakHours: ["5:00-9:00", "15:00-19:00"]
  }
};

// Add transfer points where routes intersect
const TRANSFER_POINTS = [
  {
    name: "Central Market",
    routes: ["all"],
    facilities: ["waiting shed", "public restroom"]
  },
  {
    name: "Lacson-Araneta Intersection",
    routes: ["Bata - Central", "Alijis - Central"],
    facilities: ["waiting shed"]
  },
  {
    name: "Provincial Capitol",
    routes: ["Mandalagan - Central", "Shopping - Mandalagan"],
    facilities: ["waiting shed", "public restroom"]
  }
];

// Modify the checkLocationPermission function
const checkLocationPermission = async () => {
  try {
    const { status: existingStatus } = await Location.getForegroundPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      Alert.alert(
        "Location Permission Required",
        "Please enable location services to use navigation features.",
        [
          { 
            text: "Open Settings", 
            onPress: () => router.push('/permissions') 
          },
          { 
            text: "Cancel", 
            style: "cancel" 
          }
        ]
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error checking location permission:", error);
    Alert.alert(
      "Error",
      "Failed to check location permission. Please try again.",
      [
        { 
          text: "Open Settings", 
          onPress: () => router.push('/permissions') 
        },
        { 
          text: "Cancel", 
          style: "cancel" 
        }
      ]
    );
    return false;
  }
};

// Modify the checkLocationServices function
const checkLocationServices = async () => {
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      Alert.alert(
        "Location Services Disabled",
        "Please enable location services to use navigation features.",
        [
          { 
            text: "Open Settings", 
            onPress: () => router.push('/permissions') 
          },
          { 
            text: "Cancel", 
            style: "cancel" 
          }
        ]
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error checking location services:", error);
    return false;
  }
};

// Modify the initializeLocationServices function to accept parameters
const initializeLocationServices = async (setLocation, selectedLocation, fetchDirections, locationWatchRef) => {
  try {
    const servicesEnabled = await checkLocationServices();
    if (!servicesEnabled) return;

    const hasPermission = await checkLocationPermission();
    if (!hasPermission) return;

    // Get initial location with high accuracy
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
      timeout: 15000,
      mayShowUserSettingsDialog: true
    });
    
    const newLocation = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    
    setLocation(newLocation);

    // Watch for location updates with appropriate settings for Android
    locationWatchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: Platform.OS === 'android' ? 10000 : 5000,
        distanceInterval: Platform.OS === 'android' ? 20 : 10,
        mayShowUserSettingsDialog: true
      },
      (location) => {
        const updatedLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setLocation(updatedLocation);

        // Re-fetch directions if a destination is set
        if (selectedLocation) {
          fetchDirections(updatedLocation);
        }
      }
    );
  } catch (error) {
    console.error("Error initializing location:", error);
    Alert.alert(
      "Error",
      "Failed to initialize location services. Please check your location settings and try again.",
      [
        { 
          text: "Open Settings", 
          onPress: () => router.push('/permissions') 
        },
        { 
          text: "Cancel", 
          style: "cancel" 
        }
      ]
    );
  }
};

export default function Navigation() {
  const navigationRoute = useRoute();
  const navigation = useNavigation();
  // State management
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [pwdRoute, setPwdRoute] = useState([]);
  const [pwdFastRoute, setPwdFastRoute] = useState([]);
  const [pwdSafeRoute, setPwdSafeRoute] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [fetchingRoute, setFetchingRoute] = useState(false);
  const [eta, setEta] = useState({});
  const [distance, setDistance] = useState(null);
  const [trafficDuration, setTrafficDuration] = useState({});
  const [travelMode, setTravelMode] = useState("driving");
  const [fromLocation, setFromLocation] = useState("Your Location");
  const [toLocation, setToLocation] = useState("");
  const [showPwdRoute, setShowPwdRoute] = useState(false);
  const [jeepneyRoute, setJeepneyRoute] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [walkToRoutePoint, setWalkToRoutePoint] = useState(null);
  const [alternativeJeepneyRoutes, setAlternativeJeepneyRoutes] = useState([]);
  const [usePwdRoute, setUsePwdRoute] = useState(false);
  const [nearestStop, setNearestStop] = useState(null);
  const [suggestedRoutes, setSuggestedRoutes] = useState([]);
  const [recentDestinations, setRecentDestinations] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [directions, setDirections] = useState([]);

  const mapRef = useRef(null);
  const locationWatchRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Add this useEffect to handle navigation params
  useEffect(() => {
    const params = navigationRoute.params;
    if (params?.selectedDestination) {
      const destination = params.selectedDestination;
      setQuery(destination.name);
      if (destination.placeId) {
        fetchPlaceDetails(destination.placeId);
      } else {
        fetchPlaces(destination.name);
      }
    }
  }, [navigationRoute.params]);

  // Add this effect to load recent searches when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      loadRecentSearches();
    }, [])
  );

  // Add this function to load recent searches
  const loadRecentSearches = async () => {
    try {
      const savedHistory = await AsyncStorage.getItem('navigationHistory');
      if (savedHistory) {
        setRecentSearches(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error('Error loading recent searches:', error);
    }
  };

  // Modify the fetchPlaces function to use OpenStreetMap Nominatim API
  const fetchPlaces = async (text) => {
    setQuery(text);
    if (text.length < 3) {
      setPlaces([]);
      return;
    }

    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    // Set new timeout
    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await axios.get(
          "https://nominatim.openstreetmap.org/search",
          {
            params: {
              q: text,
              format: "json",
              limit: 5,
              countrycodes: "ph",
              viewbox: "122.9409,10.6665,122.9609,10.6865", // Bacolod area
              bounded: 1
            },
            headers: {
              'User-Agent': 'Gabay-Application'
            },
            signal: abortControllerRef.current.signal
          }
        );
        
        if (response.data && response.data.length > 0) {
          const formattedPlaces = response.data.map(place => ({
            place_id: place.place_id,
            description: place.display_name,
            structured_formatting: {
              main_text: place.display_name.split(',')[0],
              secondary_text: place.display_name.split(',').slice(1).join(',').trim()
            }
          }));
          setPlaces(formattedPlaces);
        } else {
          setPlaces([]);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }
        console.error("Error fetching places:", error);
        setPlaces([]);
        Alert.alert(
          "Error",
          "Failed to fetch places. Please check your internet connection and try again.",
          [{ text: "OK" }]
        );
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  // Modify the fetchPlaceDetails function to use OpenStreetMap
  const fetchPlaceDetails = async (placeId) => {
    try {
      setLoading(true);
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/details`,
        {
          params: { 
            place_id: placeId,
            format: "json"
          },
          headers: {
            'User-Agent': 'Gabay-Application'
          }
        }
      );
      
      if (response.data && response.data.geometry) {
        const location = response.data.geometry;
        setSelectedLocation({
          latitude: parseFloat(location.lat),
          longitude: parseFloat(location.lon),
          placeId: placeId,
        });
        setToLocation(response.data.display_name);
        
        setPlaces([]);
        setQuery(response.data.display_name);
        resetRouteData();

        if (userLocation) {
          fetchDirections(userLocation);
        }
      }
    } catch (error) {
      console.error("Error fetching place details:", error);
    } finally {
      setLoading(false);
    }
  };

  // Modify the storeNavigationHistory function
  const storeNavigationHistory = async () => {
    if (!selectedLocation || !toLocation) {
      Alert.alert("Error", "No location selected to save");
      return;
    }

    try {
      if (!user) {
        Alert.alert("Error", "You must be logged in to save history");
        return;
      }

      const newDestination = {
        id: Date.now().toString(),
        name: toLocation,
        placeId: selectedLocation.placeId,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString(),
        userId: user.uid
      };

      // Add to Firestore
      const historyRef = collection(db, 'navigation_history');
      await setDoc(doc(historyRef, newDestination.id), newDestination);

      Alert.alert("Success", "Location saved to history");
      navigation.navigate('HomeTab', { refresh: true });

    } catch (error) {
      console.error('Error storing navigation history:', error);
      Alert.alert("Error", "Failed to save location to history");
    }
  };

  // Reset route-related data
  const resetRouteData = () => {
    setRoutePath([]);
    setPwdRoute([]);
    setPwdFastRoute([]);
    setPwdSafeRoute([]);
    setEta({});
    setDistance(null);
    setTrafficDuration({});
    setJeepneyRoute(null);
    setWalkToRoutePoint(null);
    setAlternativeJeepneyRoutes([]);
  };

  // Calculate recommended jeepney routes
  const calculateJeepneyRoutes = (destination) => {
    if (!destination || !userLocation) return null;
    
    // Find destination keywords in the location
    const destLower = destination.toLowerCase();
    
    // Score each route based on matching landmarks and proximity
    const scoredRoutes = JEEPNEY_ROUTES.map(route => {
      let score = 0;
      
      // Check if any landmarks match the destination name
      for (const landmark of route.landmarks) {
        if (destLower.includes(landmark.toLowerCase())) {
          score += 3; // Direct landmark match is highest priority
        }
      }
      
      // Check if route name matches destination
      if (destLower.includes(route.name.toLowerCase())) {
        score += 2;
      }
      
      // Check for partial matches in route description
      const routeParts = route.route.toLowerCase().split('→');
      for (const part of routeParts) {
        if (destLower.includes(part.trim().toLowerCase())) {
          score += 1;
        }
      }
      
      // Calculate proximity to the user's location
      const startLandmark = route.landmarks[0];
      const startLandmarkCoords = getLandmarkCoordinates(startLandmark);
      const distanceToStart = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        startLandmarkCoords.latitude,
        startLandmarkCoords.longitude
      );
      
      // Add proximity score (closer routes get higher scores)
      score += Math.max(0, 5 - distanceToStart); // Example scoring based on proximity
      
      return { ...route, score };
    });
    
    // Sort routes by score (descending)
    const sortedRoutes = scoredRoutes
      .filter(route => route.score > 0)
      .sort((a, b) => b.score - a.score);
    
    // Get primary route and alternatives
    if (sortedRoutes.length > 0) {
      setJeepneyRoute(sortedRoutes[0]);
      setAlternativeJeepneyRoutes(sortedRoutes.slice(1, 3)); // Get up to 2 alternatives
      return sortedRoutes[0];
    }
    
    // No matching routes found
    setJeepneyRoute(null);
    setAlternativeJeepneyRoutes([]);
    return null;
  };

  // Helper function to get coordinates for a landmark
  const getLandmarkCoordinates = (landmark) => {
    // This function should return the coordinates for a given landmark
    // You might need to maintain a mapping of landmarks to coordinates
    // For example:
    const landmarkCoordinates = {
      "Barangay Bata": { latitude: 10.7000, longitude: 122.9500 },
      // Add more landmarks and their coordinates here
    };
    return landmarkCoordinates[landmark] || { latitude: 0, longitude: 0 };
  };

  // Add this function to fetch accessibility data from Firebase
  const fetchAccessibilityData = async (origin, destination) => {
    try {
      // Calculate the bounding box for the route
      const minLat = Math.min(origin.latitude, destination.latitude);
      const maxLat = Math.max(origin.latitude, destination.latitude);
      const minLng = Math.min(origin.longitude, destination.longitude);
      const maxLng = Math.max(origin.longitude, destination.longitude);
      
      // Add some padding to the bounding box
      const padding = 0.01; // Approximately 1km
      
      const feedbackRef = collection(db, 'accessibility_feedback');
      const q = query(
        feedbackRef,
        where('location.latitude', '>=', minLat - padding),
        where('location.latitude', '<=', maxLat + padding)
      );
      
      const querySnapshot = await getDocs(q);
      const accessibilityPoints = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Only include points within the longitude range
        // (Firestore can't query on multiple range fields)
        if (data.location.longitude >= minLng - padding && 
            data.location.longitude <= maxLng + padding) {
          accessibilityPoints.push({
            location: {
              lat: data.location.latitude,
              lng: data.location.longitude
            },
            type: data.type,
            features: data.features
          });
        }
      });
      
      return accessibilityPoints;
    } catch (error) {
      console.error("Error fetching accessibility data:", error);
      return [];
    }
  };

  // Modify the fetchDirections function to use OpenStreetMap Routing Machine
  const fetchDirections = async (origin) => {
    if (!origin || !selectedLocation) {
      console.warn("User location or destination not set");
      return;
    }

    setFetchingRoute(true);
    
    try {
      const modes = ["driving", "walking", "jeepney"];
      const newEta = {};
      const newTrafficDuration = {};

      const isOnRoad = await checkUserRoadPosition(origin);
      const directionsOrigin = isOnRoad || !walkToRoutePoint ? origin : walkToRoutePoint;

      // If PWD route is enabled, fetch both fast and safe routes
      if (usePwdRoute) {
        try {
          // Fetch fastest PWD route
          const fastResponse = await axios.get(
            "https://router.project-osrm.org/route/v1/walking",
            {
              params: {
                start: `${directionsOrigin.longitude},${directionsOrigin.latitude}`,
                end: `${selectedLocation.longitude},${selectedLocation.latitude}`,
                alternatives: true,
                steps: true,
                annotations: true
              }
            }
          );

          // Fetch safest PWD route
          const safeResponse = await axios.get(
            "https://router.project-osrm.org/route/v1/walking",
            {
              params: {
                start: `${directionsOrigin.longitude},${directionsOrigin.latitude}`,
                end: `${selectedLocation.longitude},${selectedLocation.latitude}`,
                alternatives: true,
                steps: true,
                annotations: true
              }
            }
          );

          if (fastResponse.data.routes && fastResponse.data.routes.length > 0) {
            const fastRoute = fastResponse.data.routes[0];
            const fastPoints = fastRoute.geometry.coordinates.map(coord => ({
              latitude: coord[1],
              longitude: coord[0]
            }));
            setPwdFastRoute(fastPoints);
          }

          if (safeResponse.data.routes && safeResponse.data.routes.length > 0) {
            const safeRoute = safeResponse.data.routes[0];
            const safePoints = safeRoute.geometry.coordinates.map(coord => ({
              latitude: coord[1],
              longitude: coord[0]
            }));
            setPwdSafeRoute(safePoints);
          }
        } catch (error) {
          console.error("Error fetching PWD routes:", error);
        }
      }

      // Regular route fetching for other modes
      for (const mode of modes) {
        try {
          const response = await axios.get(
            "https://router.project-osrm.org/route/v1/" + (mode === "jeepney" ? "driving" : mode),
            {
              params: {
                start: `${directionsOrigin.longitude},${directionsOrigin.latitude}`,
                end: `${selectedLocation.longitude},${selectedLocation.latitude}`,
                alternatives: true,
                steps: true,
                annotations: true
              }
            }
          );

          if (response.data.routes && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            const leg = route.legs[0];

            newEta[mode] = formatDuration(leg.duration);
            newTrafficDuration[mode] = "N/A"; // OSRM doesn't provide traffic data
            setDistance(formatDistance(leg.distance));

            if (mode === travelMode) {
              const points = route.geometry.coordinates.map(coord => ({
                latitude: coord[1],
                longitude: coord[0]
              }));
              setRoutePath(points);
              fitMapToRoute(points);
            }
          }
        } catch (error) {
          console.error(`Error fetching ${mode} directions:`, error);
          Alert.alert(
            "Error",
            `Failed to fetch ${mode} directions. Please try again.`,
            [{ text: "OK" }]
          );
        }
      }

      setEta(newEta);
      setTrafficDuration(newTrafficDuration);

    } catch (error) {
      console.error("Error in fetchDirections:", error);
      Alert.alert(
        "Error",
        "Failed to fetch directions. Please check your internet connection and try again.",
        [{ text: "OK" }]
      );
    } finally {
      setFetchingRoute(false);
    }
  };

  // Helper function to format duration
  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // Helper function to format distance
  const formatDistance = (meters) => {
    const kilometers = meters / 1000;
    if (kilometers >= 1) {
      return `${kilometers.toFixed(1)} km`;
    }
    return `${meters.toFixed(0)} m`;
  };

  // Check if user is on a road and set walk-to-route point if needed
  // Enhanced function to check if user is on a road using reverse geocoding
  const checkUserRoadPosition = async (origin) => {
    try {
      // First approach: Try using reverse geocoding to determine if user is on a road
      const reverseGeoResponse = await axios.get(
        "https://nominatim.openstreetmap.org/reverse",
        {
          params: {
            format: "json",
            lat: origin.latitude,
            lon: origin.longitude,
            zoom: 18,
            addressdetails: 1
          },
          headers: {
            'User-Agent': 'Gabay-Application'
          }
        }
      );
      
      // Check if we got results indicating a road
      const results = reverseGeoResponse.data?.address || [];
      const isOnRoad = results.some(result => {
        // Check if any of the address components indicate a road
        return result.road || result.pedestrian || result.footway || result.path;
      });
      
      if (!isOnRoad) {
        // If not on road, find the nearest road using Roads API
        const nearestRoadResponse = await axios.get(
          "https://nominatim.openstreetmap.org/reverse",
          {
            params: {
              format: "json",
              lat: origin.latitude,
              lon: origin.longitude,
              zoom: 18,
              addressdetails: 1
            },
            headers: {
              'User-Agent': 'Gabay-Application'
            }
          }
        );
        
        if (nearestRoadResponse.data?.address) {
          const snappedPoint = {
            latitude: parseFloat(nearestRoadResponse.data.lat),
            longitude: parseFloat(nearestRoadResponse.data.lon)
          };
          
          // Calculate distance to nearest road
          const distanceToRoad = calculateDistance(
            origin.latitude,
            origin.longitude,
            snappedPoint.latitude,
            snappedPoint.longitude
          );
          
          // If user is more than 25 meters from a road, show walk path
          if (distanceToRoad > 0.025) { // 25 meters threshold
            setWalkToRoutePoint(snappedPoint);
            return false; // Not on road
          }
        }
      }
      
      // If we made it here, either user is on a road or we couldn't determine
      setWalkToRoutePoint(null);
      return true; // Assume on road
      
    } catch (error) {
      console.log("Error in reverse geocoding, trying alternative method:", error);
      
      // Fallback method: Try directions API to see if first step is a long walk
      try {
        const walkCheckResponse = await axios.get(
          "https://nominatim.openstreetmap.org/directions",
          {
            params: {
              format: "json",
              json: true,
              start: `${origin.latitude},${origin.longitude}`,
              end: `${selectedLocation ? selectedLocation.latitude : origin.latitude + 0.01},${selectedLocation ? selectedLocation.longitude : origin.longitude + 0.01}`,
              alternatives: 1,
              steps: true
            },
            headers: {
              'User-Agent': 'Gabay-Application'
            }
          }
        );
        
        if (walkCheckResponse.data.routes && walkCheckResponse.data.routes.length > 0) {
          const firstStep = walkCheckResponse.data.routes[0].legs[0].steps[0];
          
          // If first step is more than 30 meters, user might be off-road
          if (firstStep.distance.value > 30) {
            const walkToPoint = firstStep.end_location;
            setWalkToRoutePoint({
              latitude: walkToPoint.lat,
              longitude: walkToPoint.lon
            });
            return false; // Not on road
          }
        }
        
        // If we made it here, assume user is on road
        setWalkToRoutePoint(null);
        return true;
        
      } catch (secondError) {
        console.error("Error in fallback road detection:", secondError);
        setWalkToRoutePoint(null);
        return true; // Default to assuming on road in case of errors
      }
    }
  };

  // Fit map to show the route with proper padding
  const fitMapToRoute = (routePoints) => {
    if (!mapRef.current) return;
    
    try {
      const coordinates = [...routePoints];
      
      // Include user location and walk-to-route point if available
      if (userLocation) {
        coordinates.push(userLocation);
      }
      
      if (walkToRoutePoint) {
        coordinates.push(walkToRoutePoint);
      }
      
      if (coordinates.length > 1) {
        mapRef.current.fitToCoordinates(coordinates, {
          edgePadding: { top: 70, right: 70, bottom: 70, left: 70 },
          animated: true,
        });
      }
    } catch (error) {
      console.error("Error fitting map to route:", error);
    }
  };

  // Function to handle transport mode change
  const handleModeChange = (mode) => {
    setTravelMode(mode);
    
    if (mode === "jeepney" && userLocation && selectedLocation) {
      // Find nearest jeepney stop to user
      const nearestToUser = findNearestJeepneyStop(userLocation);
      setNearestStop(nearestToUser);

      // Find best jeepney routes
      const bestRoutes = findBestJeepneyRoute(userLocation, selectedLocation);
      setSuggestedRoutes(bestRoutes);
    }
    
    // Refetch directions with the new mode if we have a route
    if (userLocation && selectedLocation) {
      fetchDirections(userLocation);
    }
    
    // Calculate jeepney routes if switching to jeepney mode
    if (mode === "jeepney" && toLocation) {
      calculateJeepneyRoutes(toLocation);
    } else {
      setJeepneyRoute(null);
      setAlternativeJeepneyRoutes([]);
    }
  };

  // Helper function to calculate distance between two points (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km
    return distance;
  };

  // Toggle PWD-friendly route display
  const togglePwdRoute = () => {
    setShowPwdRoute(!showPwdRoute);
  };

  // Add this function to handle opening the Grab app
  const handleBookRide = () => {
    if (!selectedLocation) {
      Alert.alert(
        "Select Destination",
        "Please select a destination first"
      );
      return;
    }

    // Construct the Grab deep link URL
    const grabUrl = `grab://open?dropoff=${selectedLocation.latitude},${selectedLocation.longitude}&dropoffName=${encodeURIComponent(toLocation)}`;
    
    // Try to open Grab app
    Linking.canOpenURL(grabUrl)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(grabUrl);
        } else {
          // If Grab app is not installed, open Play Store/App Store
          const storeUrl = Platform.select({
            ios: 'https://apps.apple.com/app/grab-app/id647268330',
            android: 'market://details?id=com.grabtaxi.passenger'
          });
          return Linking.openURL(storeUrl);
        }
      })
      .catch((err) => {
        console.error('Error opening Grab app:', err);
        Alert.alert(
          "Error",
          "Unable to open Grab app. Please make sure it's installed."
        );
      });
  };

  // 1. Function to find nearest jeepney stop
  const findNearestJeepneyStop = (userLocation) => {
    const JEEPNEY_STOPS = {
      "Bata Terminal": { latitude: 10.6935, longitude: 122.9465 },
      "North Terminal": { latitude: 10.6897, longitude: 122.9458 },
      "Central Market": { latitude: 10.6712, longitude: 122.9465 },
      "Libertad Market": { latitude: 10.6657, longitude: 122.9447 },
      "Shopping Center": { latitude: 10.6725, longitude: 122.9469 },
      "Mandalagan Plaza": { latitude: 10.6832, longitude: 122.9472 },
      "SM City Bacolod": { latitude: 10.6707, longitude: 122.9444 },
      "Robinsons Place": { latitude: 10.6784, longitude: 122.9476 },
      // Add more stops with their coordinates
    };

    let nearestStop = null;
    let shortestDistance = Infinity;

    Object.entries(JEEPNEY_STOPS).forEach(([stopName, coordinates]) => {
      const distance = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        coordinates.latitude,
        coordinates.longitude
      );

      if (distance < shortestDistance) {
        shortestDistance = distance;
        nearestStop = { name: stopName, ...coordinates, distance };
      }
    });

    return nearestStop;
  };

  // 2. Function to find best jeepney route between two points
  const findBestJeepneyRoute = (origin, destination) => {
    let possibleRoutes = [];
    
    // Check each jeepney route
    JEEPNEY_ROUTES.forEach(route => {
      // Find the closest landmark on this route to the user
      let closestDistance = Infinity;
      let closestLandmark = null;
      
      route.landmarks.forEach(landmark => {
        const landmarkCoords = getLandmarkCoordinates(landmark);
        const distance = calculateDistance(
          origin.latitude,
          origin.longitude,
          landmarkCoords.latitude,
          landmarkCoords.longitude
        );
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestLandmark = landmark;
        }
      });
      
      // Check if destination is along this route
      const destinationMatch = route.landmarks.some(landmark => 
        isNearLocation(destination, getLandmarkCoordinates(landmark))
      );

      if (destinationMatch) {
        possibleRoutes.push({
          ...route,
          directRoute: true,
          distance: closestDistance * 1000, // Convert to meters
          closestLandmark,
          transfers: 0
        });
      }
    });

    // Sort routes by distance to user
    return possibleRoutes.sort((a, b) => a.distance - b.distance);
  };

  // 3. Function to find routes through a landmark
  const findRoutesByLandmark = (landmark) => {
    return JEEPNEY_ROUTES.filter(route => 
      route.landmarks.some(stop => 
        stop.toLowerCase().includes(landmark.toLowerCase())
      )
    );
  };

  // Helper function to check if two locations are near each other
  const isNearLocation = (location1, location2, threshold = 0.5) => {
    const distance = calculateDistance(
      location1.latitude,
      location1.longitude,
      location2.latitude,
      location2.longitude
    );
    return distance <= threshold; // threshold in kilometers
  };

  // Helper function to find transfer points between routes
  const findTransferPoints = (route1, route2) => {
    return route1.landmarks.filter(landmark => 
      route2.landmarks.includes(landmark)
    );
  };

  // Helper function to estimate route time
  const estimateRouteTime = (route) => {
    if (route.directRoute) {
      return route.landmarks.length * 5; // Rough estimate: 5 minutes per stop
    }
    return (route.route1.landmarks.length + route.route2.landmarks.length) * 5;
  };

  // Function to find routes by type of landmark
  const findRoutesByLandmarkType = (type) => {
    return JEEPNEY_ROUTES.filter(route => 
      route.landmarks.some(landmark => 
        LANDMARK_DETAILS[landmark]?.type === type
      )
    );
  };

  // Function to check if route is operating based on time
  const isRouteOperating = (route, time) => {
    const landmarks = route.landmarks;
    const currentHour = time.getHours();
    
    // Check if any landmark on route is closed
    return !landmarks.some(landmark => {
      const details = LANDMARK_DETAILS[landmark];
      if (details?.operatingHours) {
        const [open, close] = details.operatingHours.split('-');
        const openHour = parseInt(open.split(':')[0]);
        const closeHour = parseInt(close.split(':')[0]);
        return currentHour < openHour || currentHour >= closeHour;
      }
      return false;
    });
  };

  // Function to find alternative routes during peak hours
  const findAlternativeRoutes = (route, time) => {
    const landmarks = route.landmarks;
    const currentHour = time.getHours();
    
    // Check if route has congested landmarks
    const hasCongestion = landmarks.some(landmark => {
      const details = LANDMARK_DETAILS[landmark];
      if (details?.peakHours) {
        return details.peakHours.some(peak => {
          const [start, end] = peak.split('-');
          const startHour = parseInt(start.split(':')[0]);
          const endHour = parseInt(end.split(':')[0]);
          return currentHour >= startHour && currentHour < endHour;
        });
      }
      return false;
    });
    
    if (hasCongestion) {
      // Find alternative routes that avoid congested areas
      return JEEPNEY_ROUTES.filter(alt => 
        alt.name !== route.name && 
        hasCommonDestination(alt, route) &&
        !isRouteCongested(alt, time)
      );
    }
    
    return [];
  };

  // Add this useEffect inside the component
  useEffect(() => {
    // Call initializeLocationServices with the required parameters
    initializeLocationServices(setUserLocation, selectedLocation, fetchDirections, locationWatchRef);
    
    // Cleanup subscription on unmount
    return () => {
      if (locationWatchRef.current && locationWatchRef.current.remove) {
        locationWatchRef.current.remove();
      }
    };
  }, [selectedLocation]); // Add selectedLocation as a dependency

  return (
    <SafeAreaView style={styles.container}>
      {/* Map View - make it smaller */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: userLocation?.latitude || 10.6765,
          longitude: userLocation?.longitude || 122.9509,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={true}
        showsMyLocationButton={true}
        showsCompass={true}
        showsScale={true}
        showsBuildings={true}
        showsTraffic={false}
        showsIndoors={true}
        toolbarEnabled={true}
        mapType="standard"
        onMapReady={() => {
          console.log('Map is ready');
        }}
        onError={(error) => {
          console.error('Map error:', error);
        }}
      >
        {/* User location marker */}
        {userLocation && (
          <Marker coordinate={userLocation} title="You">
            <View style={styles.userMarker}>
              <View style={styles.userMarkerDot} />
            </View>
          </Marker>
        )}
        
        {/* Destination marker */}
        {selectedLocation && (
          <Marker 
            coordinate={selectedLocation} 
            title="Destination"
            pinColor="red"
          />
        )}
        
        {/* PWD Routes */}
        {usePwdRoute && (
          <>
            {/* Fastest Route */}
            {pwdFastRoute.length > 0 && (
              <Polyline 
                coordinates={pwdFastRoute}
                strokeWidth={4}
                strokeColor="#FF4081"  // Pink color for fastest route
                lineDashPattern={[0]}
              />
            )}
            
            {/* Safest Route */}
            {pwdSafeRoute.length > 0 && (
              <Polyline 
                coordinates={pwdSafeRoute}
                strokeWidth={4}
                strokeColor="#00C853"  // Green color for safest route
                lineDashPattern={[0]}
              />
            )}
          </>
        )}
        
        {/* Regular route */}
        {!usePwdRoute && routePath.length > 0 && (
          <Polyline 
            coordinates={routePath}
            strokeWidth={4}
            strokeColor="#007bff"
            lineDashPattern={[0]}
          />
        )}
        
        {/* Walk to route polyline with label */}
        {walkToRoutePoint && userLocation && (
          <>
            <Polyline
              coordinates={[userLocation, walkToRoutePoint]}
              strokeWidth={4}
              strokeColor="#000000"
              lineDashPattern={[5, 5]}
            />
            
            <Marker
              coordinate={walkToRoutePoint}
              anchor={{ x: 0.5, y: 0.5 }}
              title="Nearest Road"
            >
              <View style={styles.roadMarker}>
                <Ionicons name="navigate" size={12} color="#fff" />
              </View>
            </Marker>
            
            <Marker
              coordinate={{
                latitude: (userLocation.latitude + walkToRoutePoint.latitude) / 2,
                longitude: (userLocation.longitude + walkToRoutePoint.longitude) / 2,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              flat={true}
            >
              <View style={styles.walkLabel}>
                <Text style={styles.walkLabelText}>Walk to Road</Text>
              </View>
            </Marker>
          </>
        )}
      </MapView>

      {/* Main content - Make it a scrollable card */}
      <View style={styles.contentCardContainer}>
        {/* Search bar - fixed at top */}
        <View style={styles.searchBarContainer}>
          <View style={styles.locationFields}>
            <View style={styles.locationField}>
              <Ionicons name="location" size={18} color="#007bff" />
              <Text style={styles.locationText}>{fromLocation}</Text>
            </View>
            <View style={styles.locationField}>
              <Ionicons name="search" size={18} color="#888" />
              <TextInput
                style={styles.locationInput}
                placeholder="Where to?"
                value={query}
                onChangeText={fetchPlaces}
              />
            </View>
          </View>
          
          {/* Loading indicator */}
          {loading && <ActivityIndicator size="small" color="#007bff" style={styles.loading} />}
        </View>

        {/* Search Results - absolute positioning */}
        {places.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              nestedScrollEnabled
              data={places}
              keyExtractor={(item) => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => fetchPlaceDetails(item.place_id)}
                >
                  <Text numberOfLines={2}>{item.description}</Text>
                </TouchableOpacity>
              )}
              style={styles.suggestionsList}
              maxHeight={150}
            />
          </View>
        )}

        {/* Scrollable content */}
        <ScrollView 
          style={styles.contentScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentContainer}
        >
          {/* Info Container */}
          <View style={styles.infoContainer}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{distance || "N/A"}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>ETA</Text>
              <Text style={styles.infoValue}>{eta[travelMode] || "N/A"}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Traffic</Text>
              <Text style={styles.infoValue}>{trafficDuration[travelMode] || "N/A"}</Text>
            </View>
          </View>

          {/* Mode Buttons */}
          <View style={styles.modeButtonsGrid}>
            {["driving", "walking", "book-ride", "jeepney"].map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.modeButton,
                  travelMode === mode && styles.activeModeButton,
                ]}
                onPress={() => {
                  if (mode === "book-ride") {
                    handleBookRide();
                  } else {
                    handleModeChange(mode);
                  }
                }}
              >
                <Ionicons 
                  name={
                    mode === "driving" ? "car" : 
                    mode === "walking" ? "walk" : 
                    mode === "book-ride" ? "car-sport" : "bus"
                  } 
                  size={16} 
                  color={travelMode === mode ? "#fff" : "#007bff"} 
                />
                <Text
                  style={[
                    styles.modeButtonText,
                    travelMode === mode && styles.activeModeButtonText,
                  ]}
                >
                  {mode === "book-ride" ? "Book Ride" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* PWD Route Toggle */}
          <TouchableOpacity
            style={[
              styles.pwdRouteButton,
              usePwdRoute && styles.activePwdRouteButton
            ]}
            onPress={() => {
              setUsePwdRoute(!usePwdRoute);
              if (userLocation && selectedLocation) {
                fetchDirections(userLocation);
              }
            }}
          >
            <Ionicons 
              name="accessibility" 
              size={18} 
              color={usePwdRoute ? "#fff" : "#007bff"} 
            />
            <Text style={[
              styles.pwdRouteButtonText,
              usePwdRoute && styles.activePwdRouteButtonText
            ]}>
              PWD Route
            </Text>
          </TouchableOpacity>

          {/* Get Directions Button */}
          <TouchableOpacity
            style={styles.button}
            onPress={() => fetchDirections(userLocation)}
            disabled={fetchingRoute || !userLocation || !selectedLocation}
          >
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={styles.buttonText}>
              {fetchingRoute ? "Calculating..." : "Get Directions"}
            </Text>
          </TouchableOpacity>

          {/* Save to History Button */}
          {selectedLocation && (
            <TouchableOpacity 
              style={styles.saveHistoryButton}
              onPress={storeNavigationHistory}
            >
              <Ionicons name="bookmark-outline" size={20} color="#fff" />
              <Text style={styles.saveHistoryButtonText}>Save to History</Text>
            </TouchableOpacity>
          )}

          {/* Step by Step Directions */}
          {directions.length > 0 && (
            <View style={styles.directionsPanel}>
              <Text style={styles.directionsPanelTitle}>
                Step by Step Directions
              </Text>
              {directions.slice(0, 5).map((step, index) => (
                <View key={index} style={styles.directionStep}>
                  <View style={styles.directionStepNumber}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <View style={styles.directionStepContent}>
                    <Text style={styles.directionText} numberOfLines={2}>{step.instruction}</Text>
                    <Text style={styles.directionMetrics}>
                      {step.distance} • {step.duration}
                    </Text>
                  </View>
                </View>
              ))}
              {directions.length > 5 && (
                <TouchableOpacity 
                  style={styles.viewMoreButton}
                  onPress={() => alert("Show full directions")}
                >
                  <Text style={styles.viewMoreText}>View All Steps</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          
          {/* Bottom padding to ensure content is visible */}
          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  map: {
    height: '35%', // Make map even smaller
  },
  contentCardContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
  },
  topContent: {
    padding: 15,
    paddingBottom: 0,
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 1,
  },
  scrollContent: {
    flex: 1,
    paddingTop: 10,
  },
  locationFields: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  locationField: {
    backgroundColor: "#f8f9fa",
    borderRadius: 15,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  locationText: {
    marginLeft: 10,
    fontSize: 15,
    flex: 1,
  },
  locationInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
  },
  loading: {
    marginTop: 10,
  },
  suggestionsContainer: {
    backgroundColor: "#fff",
    marginHorizontal: 15,
    marginTop: 5,
    borderRadius: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
    maxHeight: 150,
  },
  suggestionsList: {
    maxHeight: 150,
  },
  suggestionItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f3f5",
  },
  infoContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 20,
    marginHorizontal: 15,
    marginTop: 15,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  infoItem: {
    alignItems: "center",
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: "#eee",
    paddingHorizontal: 10,
  },
  infoLabel: {
    fontSize: 12,
    color: "#6c757d",
    marginBottom: 5,
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 16,
    color: "#212529",
    fontWeight: "600",
  },
  roadMarker: {
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  walkLabel: {
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  walkLabelText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "bold",
  },
  button: {
    backgroundColor: "#007bff",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    borderRadius: 25,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
  modeButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginHorizontal: 15,
    marginTop: 15,
  },
  modeButton: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 15,
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  activeModeButton: {
    backgroundColor: "#007bff",
  },
  modeButtonText: {
    color: "#495057",
    fontWeight: "600",
    marginLeft: 8,
    fontSize: 15,
  },
  activeModeButtonText: {
    color: "#fff",
  },
  pwdRouteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 15,
    marginHorizontal: 15,
    marginTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  pwdRouteButtonText: {
    color: '#00C853',
    fontWeight: '600',
    marginLeft: 8,
    fontSize: 15,
  },
  saveHistoryButton: {
    backgroundColor: '#40B59F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 20,
    marginBottom: 20, // Add extra bottom margin
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  saveHistoryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  activePwdRouteButton: {
    backgroundColor: '#00C853',
  },
  activePwdRouteButtonText: {
    color: '#fff',
  },
  directionsPanel: {
    backgroundColor: '#fff',
    borderRadius: 15,
    margin: 15,
    marginTop: 10,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  directionsPanelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212529',
    marginBottom: 10,
  },
  directionStep: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  directionStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  stepNumberText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  directionStepContent: {
    flex: 1,
  },
  directionText: {
    fontSize: 13,
    color: '#212529',
    marginBottom: 2,
  },
  directionMetrics: {
    fontSize: 11,
    color: '#6c757d',
  },
  actionButtons: {
    padding: 15,
    paddingTop: 0,
  },

});