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
  Modal,
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
import { JEEPNEY_ROUTES_DETAILED } from './jeepney_routes'; 

const API_KEY = "AlzaSytyjooqu9_vxaqo-Azx8GTJ7ezSgjBqfvJ";

export default function Navigation() {
  const navigationRoute = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  // State management
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [fetchingRoute, setFetchingRoute] = useState(false);
  const [eta, setEta] = useState({});
  const [distance, setDistance] = useState(null);
  const [trafficDuration, setTrafficDuration] = useState({});
  const [travelMode, setTravelMode] = useState("driving");
  const [fromLocation, setFromLocation] = useState("Your Location");
  const [toLocation, setToLocation] = useState("");
  const [jeepneyRoute, setJeepneyRoute] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [walkToRoutePoint, setWalkToRoutePoint] = useState(null);
  const [alternativeJeepneyRoutes, setAlternativeJeepneyRoutes] = useState([]);
  const [nearestStop, setNearestStop] = useState(null);
  const [suggestedRoutes, setSuggestedRoutes] = useState([]);
  const [recentDestinations, setRecentDestinations] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [directions, setDirections] = useState([]);
  // Add state for scraped data and modal visibility
  const [scrapedData, setScrapedData] = useState(null);
  const [showScrapedDataModal, setShowScrapedDataModal] = useState(false);
  const [isScrapingData, setIsScrapingData] = useState(false);
  const [showJeepneyRoutesModal, setShowJeepneyRoutesModal] = useState(false);

  const mapRef = useRef(null);
  const locationWatchRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Initialize and get user location
  useEffect(() => {
    const initializeLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.warn("Permission to access location was denied");
          return;
        }

        // Get initial location
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });
        
        const newLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        
        setUserLocation(newLocation);

        // Watch for location updates
        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (location) => {
            const updatedLocation = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            };
            setUserLocation(updatedLocation);

            // Re-fetch directions if a destination is set
            if (selectedLocation) {
              fetchDirections(updatedLocation);
            }
          }
        );
      } catch (error) {
        console.error("Error initializing location:", error);
      }
    };

    initializeLocation();

    // Cleanup subscription on unmount
    return () => {
      if (locationWatchRef.current && locationWatchRef.current.remove) {
        locationWatchRef.current.remove();
      }
    };
  }, []);
  
  

  // Add this useEffect to handle navigation params
  useEffect(() => {
    const params = navigationRoute.params;
    if (params?.selectedDestination) {
      try {
        const destination = JSON.parse(params.selectedDestination);
        if (destination) {
          setQuery(destination.name);
          if (destination.placeId) {
            // Handle Google PlaceID
            fetchPlaceDetails(destination.placeId);
          } else if (destination.coordinates) {
            // Directly use coordinates when provided from homeScreen
            setSelectedLocation({
              latitude: destination.coordinates.latitude,
              longitude: destination.coordinates.longitude
            });
            setToLocation(destination.name);
            
            if (destination.location) {
              setQuery(`${destination.name}, ${destination.location}`);
            } else {
              setQuery(destination.name);
            }
            
            setPlaces([]);
            resetRouteData();
            
            if (userLocation) {
              fetchDirections(userLocation);
            }
          } else if (destination.name) {
            // Fallback to search by name
            fetchPlaces(destination.name);
          }
        }
      } catch (error) {
        console.error("Error parsing destination data:", error);
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

  // Remove the debounce function and modify fetchPlaces
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
          "https://maps.gomaps.pro/maps/api/place/autocomplete/json",
          {
            params: {
              input: text,
              key: API_KEY,
              components: "country:PH",
              location: "10.6765,122.9509", // Bacolod coordinates
              radius: 10000, // Limit to Bacolod area
              strictbounds: true,
            },
            signal: abortControllerRef.current.signal
          }
        );
        setPlaces(response.data.predictions || []);
      } catch (error) {
        if (error.name === 'AbortError') {
          // Request was aborted, do nothing
          return;
        }
        console.error("Error fetching places:", error);
        setPlaces([]);
      } finally {
        setLoading(false);
      }
    }, 500); // 500ms delay
  };

  // Modify the fetchPlaceDetails function to remove the automatic history save
  const fetchPlaceDetails = async (placeId) => {
    try {
      setLoading(true);
      const response = await axios.get(
        "https://maps.gomaps.pro/maps/api/place/details/json",
        {
          params: { 
            place_id: placeId, 
            key: API_KEY,
            fields: "geometry,name,vicinity"
          },
        }
      );
      
      if (response.data.result && response.data.result.geometry) {
        const location = response.data.result.geometry.location;
        setSelectedLocation({
          latitude: location.lat,
          longitude: location.lng,
          placeId: placeId, // Store placeId with the location
        });
        setToLocation(response.data.result.name);
        
        setPlaces([]);
        setQuery(response.data.result.name);
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

  // Reset route-related data
  const resetRouteData = () => {
    setRoutePath([]);
    setEta({});
    setDistance(null);
    setTrafficDuration({});
    setJeepneyRoute(null);
    setWalkToRoutePoint(null);
    setAlternativeJeepneyRoutes([]);
  };

  // Calculate recommended jeepney routes
  const calculateJeepneyRoutes = async (destination) => {
    if (!destination || !userLocation) return null;
    
    console.log("===== ROUTE CALCULATION =====");
    console.log("User Location:", JSON.stringify(userLocation));
    console.log("Destination:", JSON.stringify(selectedLocation));
    
    // Pass true for user location and destination to enable directional checking
    const routesNearUser = findJeepneyRoutesWithinRadius(userLocation, 0.5, true, selectedLocation); // 0.5km = 500m
    const routesNearDestination = findJeepneyRoutesWithinRadius(selectedLocation, 0.5);
    
    // Find common routes that serve both points
    let commonRoutes = routesNearUser.filter(route => 
      routesNearDestination.some(destRoute => 
        destRoute.routeId === route.routeId && 
        destRoute.pathId === route.pathId // Make sure it's the same direction/path
      )
    );

    console.log("Routes near user:", routesNearUser.length);
    console.log("Routes near destination:", routesNearDestination.length);
    console.log("Common routes:", commonRoutes.length);
    
    // Prioritize routes where the user is positioned before the destination in the route sequence
    commonRoutes = commonRoutes.filter(route => {
      // If route has directional information, use it 
      if (route.userBeforeDestination !== undefined) {
        return true; // Keep all routes but they're already sorted by directional score
      }
      return true; // Keep routes without directional info as fallback
    });
    
    // Check for directionality issues within the same path
    for (let i = commonRoutes.length - 1; i >= 0; i--) {
      const userRoute = commonRoutes[i];
      const destRoute = routesNearDestination.find(r => r.routeId === userRoute.routeId && r.pathId === userRoute.pathId);
      
      if (destRoute) {
        const routeDetails = JEEPNEY_ROUTES_DETAILED[userRoute.routeId];
        if (routeDetails && routeDetails.paths) {
          const pathDetails = routeDetails.paths.find(p => p.pathId === userRoute.pathId);
          if (pathDetails && pathDetails.via) {
            // Find indices of user and destination points in the route path
            let userPointIndex = -1;
            let destPointIndex = -1;
            let minUserDist = Infinity;
            let minDestDist = Infinity;
            
            pathDetails.via.forEach((point, index) => {
              // Check user point
              const userDist = calculateDistance(
                userLocation.latitude, 
                userLocation.longitude, 
                point.lat, 
                point.lng
              );
              
              if (userDist < minUserDist) {
                minUserDist = userDist;
                userPointIndex = index;
              }
              
              // Check destination point
              const destDist = calculateDistance(
                selectedLocation.latitude, 
                selectedLocation.longitude, 
                point.lat, 
                point.lng
              );
              
              if (destDist < minDestDist) {
                minDestDist = destDist;
                destPointIndex = index;
              }
            });
            
            // If destination comes before user in the route sequence, this direct route doesn't work
            // We need to use the combined approach instead
            if (destPointIndex < userPointIndex) {
              // Remove from common routes
              commonRoutes.splice(i, 1);
              
              // Look for the opposite direction route
              const oppositePathId = userRoute.pathId.includes('_inbound') ? 
                userRoute.pathId.replace('_inbound', '_outbound') : 
                userRoute.pathId.replace('_outbound', '_inbound');
              
              const oppositePathDetails = routeDetails.paths.find(p => p.pathId === oppositePathId);
              
              if (oppositePathDetails) {
                // Add as a combined route option
                const oppositeRoute = routesNearDestination.find(r => r.routeId === userRoute.routeId && r.pathId === oppositePathId);
                
                if (oppositeRoute) {
                  // This is a case where we need to go to the end of the current route
                  // and then take the opposite direction route to reach the destination
                  commonRoutes.push({
                    ...userRoute,
                    destinationRoute: oppositeRoute,
                    combinedInboundOutbound: true,
                    circularRoute: true // Flag that this is a circular route combination
                  });
                }
              }
            }
          }
        }
      }
    }
    
          // Check for inbound/outbound pattern where user is on one path and destination is on another
    if (commonRoutes.length === 0) {
      // Look for cases where origin and destination are on different paths of the same route
      routesNearUser.forEach(userRoute => {
        routesNearDestination.forEach(destRoute => {
          // Special handling for Banago-Libertad route (routeId 1)
          const isBanagoLibertad = userRoute.routeId === "1" && destRoute.routeId === "1";
          
          if (userRoute.routeId === destRoute.routeId && 
              userRoute.pathId !== destRoute.pathId &&
              ((userRoute.pathId.includes('_inbound') && destRoute.pathId.includes('_outbound')) ||
               (userRoute.pathId.includes('_outbound') && destRoute.pathId.includes('_inbound')))) {
            
            // We found a case where user and destination are on different paths of the same route
            // Add this as a special combined route option
            commonRoutes.push({
              ...userRoute,
              destinationRoute: destRoute,
              combinedInboundOutbound: true,
              banagoLibertadSpecial: isBanagoLibertad // Mark if this is the special Banago-Libertad route
            });
          }
          
          // Special case for Banago-Libertad: if both user and destination are on inbound/outbound 
          // but user needs to go backward, add a combined route option
          if (isBanagoLibertad && userRoute.pathId === destRoute.pathId) {
            // Check if user is after destination in the route sequence
            if (userRoute.pointIndex !== undefined && 
                destRoute.pointIndex !== undefined && 
                userRoute.pointIndex > destRoute.pointIndex) {
              
              // Find the opposite direction path
              const currentPath = userRoute.pathId;
              const oppositePathId = currentPath.includes('_inbound') ? 
                currentPath.replace('_inbound', '_outbound') : 
                currentPath.replace('_outbound', '_inbound');
              
              // Add this as a special circular route option
              commonRoutes.push({
                ...userRoute,
                destinationRoute: destRoute,
                combinedInboundOutbound: true,
                circularRoute: true,
                banagoLibertadSpecial: true, // Mark as the special Banago-Libertad route
                oppositePathId: oppositePathId
              });
            }
          }
        });
      });

      // Also check if there are any explicitly created combined routes from findJeepneyRoutesWithinRadius
      const combinedRoutesNearUser = routesNearUser.filter(r => r.combinedRoute);
      const combinedRoutesNearDest = routesNearDestination.filter(r => r.combinedRoute);
      
      // Add combined routes that are present for both user and destination
      combinedRoutesNearUser.forEach(userCombinedRoute => {
        combinedRoutesNearDest.forEach(destCombinedRoute => {
          if (userCombinedRoute.routeId === destCombinedRoute.routeId) {
            commonRoutes.push({
              ...userCombinedRoute,
              destinationRoute: destCombinedRoute,
              combinedInboundOutbound: true
            });
          }
        });
      });
    }
    
    // Check all route options (direct and combined) and prioritize based on user-before-destination sequence
    if (commonRoutes.length > 0) {
      // First, remove any direct routes that would require backward travel
      // We'll create proper combined routes instead
      commonRoutes = commonRoutes.filter(route => {
        // Skip this check for already combined routes
        if (route.combinedInboundOutbound) return true;
        
        const routeDetails = JEEPNEY_ROUTES_DETAILED[route.routeId];
        if (!routeDetails || !routeDetails.paths) return true;
        
        const pathDetails = routeDetails.paths.find(p => p.pathId === route.pathId);
        if (!pathDetails || !pathDetails.via) return true;
        
        // Find user and destination sequence positions
        let userPointIndex = -1;
        let destPointIndex = -1;
        let minUserDist = Infinity;
        let minDestDist = Infinity;
        
        pathDetails.via.forEach((point, index) => {
          // Check user point
          const userDist = calculateDistance(
            userLocation.latitude, 
            userLocation.longitude, 
            point.lat, 
            point.lng
          );
          
          if (userDist < minUserDist) {
            minUserDist = userDist;
            userPointIndex = index;
          }
          
          // Check destination point
          const destDist = calculateDistance(
            selectedLocation.latitude, 
            selectedLocation.longitude, 
            point.lat, 
            point.lng
          );
          
          if (destDist < minDestDist) {
            minDestDist = destDist;
            destPointIndex = index;
          }
        });
        
        // Reject direct routes that would require backward travel
        return userPointIndex < destPointIndex;
      });
      
      // If we filtered out all direct routes, try to create combined routes
      if (commonRoutes.length === 0) {
        // For each rejected route, create a proper combined inbound/outbound route
        routesNearUser.forEach(userRoute => {
          // Only process routes that are close to both user and destination
          const matchingDestRoutes = routesNearDestination.filter(
            r => r.routeId === userRoute.routeId
          );
          
          if (matchingDestRoutes.length > 0) {
            const routeDetails = JEEPNEY_ROUTES_DETAILED[userRoute.routeId];
            if (!routeDetails || !routeDetails.paths) return;
            
            // Check if both inbound and outbound paths exist for this route
            const inboundPath = routeDetails.paths.find(p => p.pathId.includes('_inbound'));
            const outboundPath = routeDetails.paths.find(p => p.pathId.includes('_outbound'));
            
            if (inboundPath && outboundPath) {
              // Find which path the user is on
              const userPathInfo = routeDetails.paths.find(p => p.pathId === userRoute.pathId);
              
              // Find the corresponding dest route on the opposite path
              const oppositePathId = userRoute.pathId.includes('_inbound') ? 
                userRoute.pathId.replace('_inbound', '_outbound') : 
                userRoute.pathId.replace('_outbound', '_inbound');
              
              const destRoute = routesNearDestination.find(r => r.routeId === userRoute.routeId && r.pathId === oppositePathId);
              
              if (userPathInfo && destRoute) {
                // This is a proper combined route - add it
                commonRoutes.push({
                  ...userRoute,
                  destinationRoute: destRoute,
                  combinedInboundOutbound: true,
                  forcedCombined: true, // Mark this as a forced combined route
                  routeId: userRoute.routeId,
                  banagoLibertadSpecial: userRoute.routeId === "1" // Special handling for Banago-Libertad
                });
              }
            }
          }
        });
      }
      
      // Calculate a route score for each option 
      // Lower score is better - routes where user's location comes before destination get lower scores
      commonRoutes = commonRoutes.map(route => {
        const routeDetails = JEEPNEY_ROUTES_DETAILED[route.routeId];
        let sequenceScore = 1000; // Default high score (worse)
        
        if (routeDetails && routeDetails.paths) {
          // For direct routes (same path)
          if (!route.combinedInboundOutbound) {
            const pathDetails = routeDetails.paths.find(p => p.pathId === route.pathId);
            
            if (pathDetails && pathDetails.via) {
              // Find user and destination sequence positions
              let userPointIndex = -1;
              let destPointIndex = -1;
              let minUserDist = Infinity;
              let minDestDist = Infinity;
              
              pathDetails.via.forEach((point, index) => {
                // Check user point
                const userDist = calculateDistance(
                  userLocation.latitude, 
                  userLocation.longitude, 
                  point.lat, 
                  point.lng
                );
                
                if (userDist < minUserDist) {
                  minUserDist = userDist;
                  userPointIndex = index;
                }
                
                // Check destination point
                const destDist = calculateDistance(
                  selectedLocation.latitude, 
                  selectedLocation.longitude, 
                  point.lat, 
                  point.lng
                );
                
                if (destDist < minDestDist) {
                  minDestDist = destDist;
                  destPointIndex = index;
                }
              });
              
              // Calculate score - favor routes where user comes before destination
              // This shouldn't happen now due to our filtering, but just in case
              if (userPointIndex !== -1 && destPointIndex !== -1) {
                if (userPointIndex < destPointIndex) {
                  // Ideal case: user before destination
                  sequenceScore = 0;
                } else {
                  // User after destination - should use combined route instead
                  sequenceScore = 500 + (userPointIndex - destPointIndex); // Higher penalty the further back the destination is
                }
              }
            }
          } 
          // For combined routes
          else {
            // Combined routes are constructed correctly to avoid backward travel
            sequenceScore = route.forcedCombined ? 100 : // Prioritize forced combined routes (created to avoid backward travel)
                           (route.circularRoute ? 400 : 300); // Other combined routes
          }
        }
        
        return {
          ...route,
          sequenceScore
        };
      });
      
      // Sort routes by sequence score (ascending - lower is better)
      commonRoutes.sort((a, b) => a.sequenceScore - b.sequenceScore);
      
      // Log the route selection
      if (commonRoutes.length > 0) {
        const bestRoute = commonRoutes[0];
        console.log("Selected best route:", 
          bestRoute.routeId, 
          bestRoute.pathId, 
          bestRoute.combinedInboundOutbound ? 
            (bestRoute.forcedCombined ? "FORCED-COMBINED" : 
             (bestRoute.circularRoute ? "CIRCULAR" : "COMBINED")) : 
            "DIRECT"
        );
      }
    }
    
          // Case 1: Direct route available (same jeepney passes near both user and destination)
    if (commonRoutes.length > 0) {
      // Use the first common route (closest to user)
      const selectedRoute = commonRoutes[0];
      const routeDetails = JEEPNEY_ROUTES_DETAILED[selectedRoute.routeId];
      
      console.log("Selected route:", routeDetails.name);
      console.log("Route type:", selectedRoute.combinedInboundOutbound ? (selectedRoute.circularRoute ? "Circular" : "Combined inbound/outbound") : "Direct");
      
      if (routeDetails && routeDetails.paths && routeDetails.paths.length > 0) {
        // Handle combined inbound/outbound route case
        if (selectedRoute.combinedInboundOutbound) {
          // This is a special case where the user and destination are on different paths of the same route
          const destinationRoute = selectedRoute.destinationRoute;
          
          // Find the specific paths
          const userPathInfo = routeDetails.paths.find(p => p.pathId === selectedRoute.pathId);
          const destPathInfo = routeDetails.paths.find(p => p.pathId === destinationRoute.pathId);
          
          if (!userPathInfo || !destPathInfo) return null; // Path not found
          
          // Extract points for the user's path
          const userRoutePath = userPathInfo.via.map(point => ({
            latitude: point.lat,
            longitude: point.lng
          }));
          
          // Extract points for the destination's path
          const destRoutePath = destPathInfo.via.map(point => ({
            latitude: point.lat,
            longitude: point.lng
          }));
          
          // Get the access points
          const userAccessPoint = {
            latitude: selectedRoute.nearestPoint.lat,
            longitude: selectedRoute.nearestPoint.lng
          };
          
          const destinationAccessPoint = {
            latitude: destinationRoute.nearestPoint.lat,
            longitude: destinationRoute.nearestPoint.lng
          };
          
          // Create a combined route - user access point to first/last stop, then to destination access point
          let combinedPathPoints = [];
          
          if (selectedRoute.circularRoute) {
            // Special handling for a circular route where the destination is "behind" the user
            // Find user position in current path
            let userPointIndex = 0;
            let minUserDist = Infinity;
            
            userRoutePath.forEach((point, index) => {
              const dist = calculateDistance(
                point.latitude,
                point.longitude,
                userAccessPoint.latitude,
                userAccessPoint.longitude
              );
              
              if (dist < minUserDist) {
                minUserDist = dist;
                userPointIndex = index;
              }
            });
            
            // Find destination position in opposite path
            let destPointIndex = 0;
            let minDestDist = Infinity;
            
            destRoutePath.forEach((point, index) => {
              const dist = calculateDistance(
                point.latitude,
                point.longitude,
                destinationAccessPoint.latitude,
                destinationAccessPoint.longitude
              );
              
              if (dist < minDestDist) {
                minDestDist = dist;
                destPointIndex = index;
              }
            });
            
            // Build route: from user to end of current path, then from start of opposite path to destination
            combinedPathPoints = [userAccessPoint];
            
            // Add path from user position to end of current path
            combinedPathPoints = combinedPathPoints.concat(userRoutePath.slice(userPointIndex));
            
            // Add path from start of opposite path to destination
            if (destPointIndex >= 0) {
              combinedPathPoints = combinedPathPoints.concat(destRoutePath.slice(0, destPointIndex + 1));
            }
            
            // Add destination access point
            combinedPathPoints.push(destinationAccessPoint);
          } else {
            // Regular case - user and dest are on different paths
            // Determine if we're going from inbound to outbound or vice versa
                      // Enhanced route handling for all routes, with special logging for Banago-Libertad
          if (selectedRoute.forcedCombined || selectedRoute.banagoLibertadSpecial) {
            if (selectedRoute.banagoLibertadSpecial) {
              console.log("Using special Banago-Libertad route handling");
            } else {
              console.log("Using enhanced combined route handling to avoid backward travel");
            }
            
            // Find the best path that avoids backward travel
            let userPointIndex = -1;
            let destPointIndex = -1;
            
            // Find the closest points in the paths
            userRoutePath.forEach((point, index) => {
              const dist = calculateDistance(
                point.latitude, point.longitude,
                userAccessPoint.latitude, userAccessPoint.longitude
              );
              if (userPointIndex === -1 || dist < calculateDistance(
                userRoutePath[userPointIndex].latitude, userRoutePath[userPointIndex].longitude,
                userAccessPoint.latitude, userAccessPoint.longitude
              )) {
                userPointIndex = index;
              }
            });
            
            destRoutePath.forEach((point, index) => {
              const dist = calculateDistance(
                point.latitude, point.longitude,
                destinationAccessPoint.latitude, destinationAccessPoint.longitude
              );
              if (destPointIndex === -1 || dist < calculateDistance(
                destRoutePath[destPointIndex].latitude, destRoutePath[destPointIndex].longitude,
                destinationAccessPoint.latitude, destinationAccessPoint.longitude
              )) {
                destPointIndex = index;
              }
            });
            
            console.log("User's path:", selectedRoute.pathId, "at index", userPointIndex);
            console.log("Destination path:", destinationRoute.pathId, "at index", destPointIndex);
            
            // For jeepneys, routes meet at the terminals (start/end points)
            const userIsInbound = selectedRoute.pathId.includes('_inbound');
            const destIsInbound = destinationRoute.pathId.includes('_inbound');
            
            // Determine which paths are inbound vs outbound
            const inboundPath = userIsInbound ? userRoutePath : destRoutePath;
            const outboundPath = userIsInbound ? destRoutePath : userRoutePath;
            
            // Start building the path
            combinedPathPoints = [userAccessPoint];
            
            if (userIsInbound && !destIsInbound) {
              // User is on inbound, destination is on outbound
              // Points: user -> end of inbound -> start of outbound -> destination
              console.log("Creating INBOUND to OUTBOUND path");
              
              // Add path from user to end of inbound (terminal)
              if (userPointIndex < inboundPath.length - 1) {
                combinedPathPoints = combinedPathPoints.concat(inboundPath.slice(userPointIndex));
              }
              
              // Add path from start of outbound to destination
              if (destPointIndex > 0) {
                combinedPathPoints = combinedPathPoints.concat(outboundPath.slice(0, destPointIndex + 1));
              }
            } else if (!userIsInbound && destIsInbound) {
              // User is on outbound, destination is on inbound
              // Points: user -> end of outbound -> start of inbound -> destination
              console.log("Creating OUTBOUND to INBOUND path");
              
              // Add path from user to end of outbound (terminal)
              if (userPointIndex < outboundPath.length - 1) {
                combinedPathPoints = combinedPathPoints.concat(outboundPath.slice(userPointIndex));
              }
              
              // Add path from start of inbound to destination
              if (destPointIndex > 0) {
                combinedPathPoints = combinedPathPoints.concat(inboundPath.slice(0, destPointIndex + 1));
              }
            } else {
              // Both on same path type, but we need to use the opposite path to avoid going backward
              console.log("Creating SAME-PATH-TYPE combined route to avoid backward travel");
              
              // Check which path the user is on
              const userPath = userRoutePath;
              const terminalIndex = userPath.length - 1;

              // Follow user's current path to the end (terminal)
              if (userPointIndex < terminalIndex) {
                combinedPathPoints = combinedPathPoints.concat(userPath.slice(userPointIndex, terminalIndex + 1));
              }
              
              // Now add the destination path from start to destination
              if (destPointIndex > 0) {
                combinedPathPoints = combinedPathPoints.concat(destRoutePath.slice(0, destPointIndex + 1));
              }
            }
            
            // Finish with destination access point
            combinedPathPoints.push(destinationAccessPoint);
            
            // Log the constructed path
            console.log("Created combined path with", combinedPathPoints.length, "points");
          } else {
            // Standard handling for other routes
            if (selectedRoute.pathId.includes('_inbound') && destinationRoute.pathId.includes('_outbound')) {
              // User is on inbound, destination is on outbound
              // Use our enhanced getRelevantRouteSegment for combined routes
              combinedPathPoints = getRelevantRouteSegment(
                null, // Not used in combined mode
                userAccessPoint,
                destinationAccessPoint,
                true, // This is a combined route
                userRoutePath, // Inbound path (user's)
                destRoutePath  // Outbound path (destination's)
              );
            } else {
              // User is on outbound, destination is on inbound
              // Use our enhanced getRelevantRouteSegment for combined routes
              combinedPathPoints = getRelevantRouteSegment(
                null, // Not used in combined mode
                userAccessPoint,
                destinationAccessPoint,
                true, // This is a combined route
                userRoutePath, // Outbound path (user's)
                destRoutePath  // Inbound path (destination's)
              );
            }
          }
          }
          
          // Create walking paths
          const walkToJeepneyPath = [
            { latitude: userLocation.latitude, longitude: userLocation.longitude },
            userAccessPoint
          ];
          
          const walkFromJeepneyPath = [
            destinationAccessPoint,
            { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }
          ];
          
          // Get descriptive names for the paths
          const userDirectionText = selectedRoute.pathId.includes('_inbound') ? 'inbound' : 'outbound';
          const destDirectionText = destinationRoute.pathId.includes('_inbound') ? 'inbound' : 'outbound';
          
          // Calculate total walking distance
          const totalWalkingDistance = selectedRoute.distance + destinationRoute.distance;
          
          // Set the jeepney route info
          const jeepneyRouteInfo = {
            ...routeDetails,
            name: `${routeDetails.name} (${userDirectionText} to ${destDirectionText})`,
            type: selectedRoute.circularRoute ? 'circular-route' : 'combined-inout',
            userAccessPoint: userAccessPoint,
            destinationAccessPoint: destinationAccessPoint,
            distance: selectedRoute.distance,
            destinationDistance: destinationRoute.distance,
            totalWalkingDistance: totalWalkingDistance,
            segmentedPathPoints: combinedPathPoints,
            walkToJeepneyPath: walkToJeepneyPath,
            walkFromJeepneyPath: walkFromJeepneyPath,
            routeId: selectedRoute.routeId,
            userPathId: selectedRoute.pathId,
            destPathId: destinationRoute.pathId,
            userPath: userPathInfo,
            destPath: destPathInfo,
            from: selectedRoute.circularRoute ? userPathInfo.from : userPathInfo.from,
            to: selectedRoute.circularRoute ? destPathInfo.to : destPathInfo.to,
            circularRoute: selectedRoute.circularRoute
          };
          
                      // Store the route info
            setJeepneyRoute(jeepneyRouteInfo);
            setRoutePath(combinedPathPoints);
            setAlternativeJeepneyRoutes([]);
            
            // Log the coordinates of the combined route
            console.log(`===== ${selectedRoute.circularRoute ? "CIRCULAR" : "COMBINED"} ROUTE COORDINATES =====`);
            console.log("User path:", userPathInfo.from, "to", userPathInfo.to);
            console.log("Destination path:", destPathInfo.from, "to", destPathInfo.to);
            console.log("Access point coordinates:");
            console.log("- User access point:", JSON.stringify(userAccessPoint));
            console.log("- Destination access point:", JSON.stringify(destinationAccessPoint));
            console.log("Combined route segment coordinates (start to end):");
            combinedPathPoints.forEach((point, index) => {
              console.log(`${index}:`, JSON.stringify(point));
            });
            
            // Fit map to include all route components
            fitMapToRoute([
              ...walkToJeepneyPath, 
              ...combinedPathPoints, 
              ...walkFromJeepneyPath
            ]);
            
            return jeepneyRouteInfo;
          
        } else {
          // Regular case - same path for user and destination
          // Find the specific path based on pathId
          const pathIndex = routeDetails.paths.findIndex(p => p.pathId === selectedRoute.pathId);
          if (pathIndex === -1) return null; // Path not found
          
          const selectedPath = routeDetails.paths[pathIndex];
          
          // Extract all points for this specific path
          const fullRoutePath = selectedPath.via.map(point => ({
            latitude: point.lat,
            longitude: point.lng
          }));
          
          // Get the access points
          const userAccessPoint = {
            latitude: selectedRoute.nearestPoint.lat,
            longitude: selectedRoute.nearestPoint.lng
          };
          
          // Find the same route near destination
          const destinationRouteInfo = routesNearDestination.find(r => 
            r.routeId === selectedRoute.routeId && 
            r.pathId === selectedRoute.pathId
          );
          
          const destinationAccessPoint = {
            latitude: destinationRouteInfo.nearestPoint.lat,
            longitude: destinationRouteInfo.nearestPoint.lng
          };
          
          // Get the full jeepney route segment between access points
          const relevantSegment = getRelevantRouteSegment(
            fullRoutePath, 
            userAccessPoint, 
            destinationAccessPoint
          );
          
          // Create walking paths
          const walkToJeepneyPath = [
            { latitude: userLocation.latitude, longitude: userLocation.longitude },
            userAccessPoint
          ];
          
          const walkFromJeepneyPath = [
            destinationAccessPoint,
            { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }
          ];
          
          // Determine if we're using inbound or outbound route
          const directionText = selectedPath.pathId.includes('_inbound') ? 'inbound' :
                              selectedPath.pathId.includes('_outbound') ? 'outbound' : '';
          
          // Get the route name with direction if available
          const routeName = directionText ? 
            `${routeDetails.name} (${directionText})` : routeDetails.name;
          
          // Calculate total walking distance
          const totalWalkingDistance = selectedRoute.distance + destinationRouteInfo.distance;
          
          // Set the jeepney route info
          const jeepneyRouteInfo = {
            ...routeDetails,
            name: routeName,
            type: 'direct',
            userAccessPoint: userAccessPoint,
            destinationAccessPoint: destinationAccessPoint,
            distance: selectedRoute.distance,
            destinationDistance: destinationRouteInfo.distance,
            totalWalkingDistance: totalWalkingDistance,
            pathPoints: fullRoutePath, // Keep the full path for reference
            segmentedPathPoints: relevantSegment, // Use the full segment path for display
            walkToJeepneyPath: walkToJeepneyPath,
            walkFromJeepneyPath: walkFromJeepneyPath,
            routeId: selectedRoute.routeId,
            pathId: selectedPath.pathId,
            from: selectedPath.from,
            to: selectedPath.to
          };
          
          // Store the route info
          setJeepneyRoute(jeepneyRouteInfo);
          setRoutePath(relevantSegment);
          setAlternativeJeepneyRoutes([]);
          
          // Log the coordinates of the route
          console.log("===== DIRECT ROUTE COORDINATES =====");
          console.log("From:", selectedPath.from, "To:", selectedPath.to);
          console.log("Access point coordinates:");
          console.log("- User access point:", JSON.stringify(userAccessPoint));
          console.log("- Destination access point:", JSON.stringify(destinationAccessPoint));
          console.log("Route segment coordinates (start to end):");
          relevantSegment.forEach((point, index) => {
            console.log(`${index}:`, JSON.stringify(point));
          });
          
          // Fit map to include all route components
          fitMapToRoute([
            ...walkToJeepneyPath, 
            ...relevantSegment, 
            ...walkFromJeepneyPath
          ]);
          
          return jeepneyRouteInfo;
        }
      }
    } 
    // Case 2: No direct route, first check for combined inbound/outbound routes before trying transfers
    else {
      console.log("No direct route found - checking for inbound/outbound combination options first");
      
      // First, try to find combined inbound-outbound routes for each route present near both user and destination
      let combinedRoute = null;
      
      // Group routes by routeId to check for inbound/outbound combinations
      routesNearUser.forEach(userRoute => {
        // Skip if we already found a suitable combined route
        if (combinedRoute) return;
        
        const routeId = userRoute.routeId;
        const routeDetails = JEEPNEY_ROUTES_DETAILED[routeId];
        if (!routeDetails || !routeDetails.paths) return;
        
        // Get all destination routes for this same routeId
        const matchingDestRoutes = routesNearDestination.filter(r => r.routeId === routeId);
        if (matchingDestRoutes.length === 0) return;
        
        console.log(`Found route ${routeId} present at both user location and destination`);
        
        // Check if this route has inbound & outbound paths
        const inboundPaths = routeDetails.paths.filter(p => p.pathId.includes('_inbound'));
        const outboundPaths = routeDetails.paths.filter(p => p.pathId.includes('_outbound'));
        
        if (inboundPaths.length === 0 || outboundPaths.length === 0) {
          console.log(`Route ${routeId} doesn't have both inbound and outbound paths`);
          return;
        }
        
        // Separate user routes by direction
        const userInbound = userRoute.pathId.includes('_inbound');
        const userOutbound = userRoute.pathId.includes('_outbound');
        
        // Check each destination route
        for (const destRoute of matchingDestRoutes) {
          const destInbound = destRoute.pathId.includes('_inbound');
          const destOutbound = destRoute.pathId.includes('_outbound');
          
          // If user and dest are on same path, check if user is before dest
          if ((userInbound && destInbound) || (userOutbound && destOutbound)) {
            // Check if user is before destination
            if (userRoute.pointIndex < destRoute.pointIndex) {
              // This would be a direct route, which we've already checked, so skip
              continue;
            } else {
              // User is after destination - need combined route via terminal
              console.log(`User at index ${userRoute.pointIndex} is after destination at ${destRoute.pointIndex} - creating circular route`);
              combinedRoute = {
                ...userRoute,
                destinationRoute: destRoute,
                combinedInboundOutbound: true,
                circularRoute: true,
                forcedCombined: true,
                banagoLibertadSpecial: routeId === "1"
              };
              break;
            }
          }
          // If user and dest are on different paths, this is an ideal case
          else if ((userInbound && destOutbound) || (userOutbound && destInbound)) {
            console.log(`User on ${userInbound ? 'inbound' : 'outbound'} and destination on ${destInbound ? 'inbound' : 'outbound'} - ideal for combined route`);
            combinedRoute = {
              ...userRoute,
              destinationRoute: destRoute,
              combinedInboundOutbound: true,
              forcedCombined: true,
              banagoLibertadSpecial: routeId === "1"
            };
            break;
          }
        }
      });
      
      // If we found a combined route, use it instead of transfers
      if (combinedRoute) {
        console.log("Using combined inbound/outbound route");
        selectedRoute = combinedRoute;
        
        // Continue with the combined route handling by returning to the main case
        return calculateJeepneyRoutes(destination);
      }
      
      // If no combined route found, continue with transfer logic
      console.log("No suitable inbound/outbound combination found - checking for transfers");
      
      // Step 1: Get all routes near user and destination
      const userRoutes = routesNearUser;
      const destRoutes = routesNearDestination;
      
      if (!userRoutes.length || !destRoutes.length) return null;
      
      // Step 2: Find valid transfers between routes
      const transferOptions = [];
      
      // Check each combination of routes for valid transfers
      for (const userRoute of userRoutes) {
        const userRouteDetails = JEEPNEY_ROUTES_DETAILED[userRoute.routeId];
        
        if (!userRouteDetails || !userRouteDetails.paths || !userRouteDetails.paths.length) continue;
        
        // Find the specific path for user's route
        const userPathIndex = userRouteDetails.paths.findIndex(p => p.pathId === userRoute.pathId);
        if (userPathIndex === -1) continue;
        
        const userPath = userRouteDetails.paths[userPathIndex];
        
        // Check if user's position requires backward travel on this path
        let userPointIndex = -1;
        if (userRoute.pointIndex !== undefined) {
          userPointIndex = userRoute.pointIndex;
        }
        
        // Convert path to map coordinates
        const userRoutePath = userPath.via.map(point => ({
          latitude: point.lat,
          longitude: point.lng
        }));
        
        for (const destRoute of destRoutes) {
          // Skip if it's the same route and path (this would be a direct route, already handled above)
          if (userRoute.routeId === destRoute.routeId && userRoute.pathId === destRoute.pathId) continue;
          
          const destRouteDetails = JEEPNEY_ROUTES_DETAILED[destRoute.routeId];
          
          if (!destRouteDetails || !destRouteDetails.paths || !destRouteDetails.paths.length) continue;
          
          // Find the specific path for destination's route
          const destPathIndex = destRouteDetails.paths.findIndex(p => p.pathId === destRoute.pathId);
          if (destPathIndex === -1) continue;
          
          const destPath = destRouteDetails.paths[destPathIndex];
          
          const destRoutePath = destPath.via.map(point => ({
            latitude: point.lat,
            longitude: point.lng
          }));
          
          // Find transfer point between routes
          const transferPoint = findTransferPoint(userRoutePath, destRoutePath, userRoute.routeId, destRoute.routeId);
          
          // Only add if a valid transfer point exists (routes are connected)
          if (transferPoint) {
            // Check if transfer requires backward travel on user route
            let invalidTransfer = false;
            
            // Get the user's position on their route
            if (userPointIndex !== -1 && transferPoint.route1Index !== undefined) {
              // Check if transfer point is before the user's position
              if (transferPoint.route1Index < userPointIndex) {
                console.log(`Transfer at index ${transferPoint.route1Index} is before user at ${userPointIndex} - invalid transfer`);
                invalidTransfer = true;
              }
            }
            
            // Check if destination route has proper direction
            let destPointIndex = -1;
            if (destRoute.pointIndex !== undefined) {
              destPointIndex = destRoute.pointIndex;
            }
            
            if (destPointIndex !== -1 && transferPoint.route2Index !== undefined) {
              // Check if transfer point is after the destination on the dest route
              if (transferPoint.route2Index > destPointIndex) {
                console.log(`Transfer at index ${transferPoint.route2Index} is after destination at ${destPointIndex} on dest route - invalid transfer`);
                invalidTransfer = true;
              }
            }
            
            // Skip this transfer if it would require backward travel
            if (invalidTransfer) {
              console.log(`Invalid transfer skipped for ${userRoute.routeId} to ${destRoute.routeId}`);
              continue;
            }
            // Determine if the routes are inbound or outbound
            const userDirectionText = userPath.pathId.includes('_inbound') ? 'inbound' :
                                     userPath.pathId.includes('_outbound') ? 'outbound' : '';
            
            const destDirectionText = destPath.pathId.includes('_inbound') ? 'inbound' :
                                     destPath.pathId.includes('_outbound') ? 'outbound' : '';
            
            // Get the route names with direction if available
            const userRouteName = userDirectionText ? 
              `${userRouteDetails.name} (${userDirectionText})` : userRouteDetails.name;
              
            const destRouteName = destDirectionText ? 
              `${destRouteDetails.name} (${destDirectionText})` : destRouteDetails.name;
            
            // Calculate total walking distance
            const totalWalkingDistance = userRoute.distance + destRoute.distance + (transferPoint.distance / 1000);
            
            // Calculate directionality score for transfer
            let directionScore = 0;
            
            // Prefer staying in the same direction if possible (both inbound or both outbound)
            const sameDirection = 
              (userPath.pathId.includes('_inbound') && destPath.pathId.includes('_inbound')) ||
              (userPath.pathId.includes('_outbound') && destPath.pathId.includes('_outbound'));
            
            if (sameDirection) {
              directionScore -= 50; // Bonus for staying in same direction
            } else {
              directionScore += 50; // Penalty for changing directions
            }
            
            // Add position data for more precise transfer planning
            const transferInfo = {
              userRoute: {
                ...userRoute,
                name: userRouteName,
                pathDetails: userPath
              },
              destRoute: {
                ...destRoute,
                name: destRouteName,
                pathDetails: destPath
              },
              transferPoint: transferPoint,
              transferDistance: transferPoint.distance,
              totalWalkingDistance: totalWalkingDistance,
              // Include direction info and indices for better sorting
              userPointIndex: userPointIndex,
              destPointIndex: destPointIndex,
              transferUserIndex: transferPoint.route1Index,
              transferDestIndex: transferPoint.route2Index,
              sameDirection: sameDirection,
              directionScore: directionScore,
              // For regular users, consider total distance plus direction score
              totalDistance: userRoute.distance + destRoute.distance + (transferPoint.distance / 1000),
              
              // Calculate estimated travel time for each segment
              // 1. Time to walk to first jeepney (at 4 km/h walking speed = 15 min/km)
              walkToJeepneyTime: userRoute.distance * 15,
              
              // 2. First jeepney travel time (average speed of 15 km/h = 4 min/km)
              firstJeepneyTime: calculatePolylineDistance(userRoutePath) / 250, // 250m per minute
              
              // 3. Transfer walking time (slower due to navigation/waiting)
              transferWalkTime: (transferPoint.distance / 1000) * 20, // 20 min/km for transfers
              
              // 4. Second jeepney travel time
              secondJeepneyTime: calculatePolylineDistance(destRoutePath) / 250, // 250m per minute
              
              // 5. Walking time from second jeepney to destination
              walkFromJeepneyTime: destRoute.distance * 15,
              
              // Calculate total travel time
              get totalTravelTime() {
                return this.walkToJeepneyTime + this.firstJeepneyTime + 
                       this.transferWalkTime + this.secondJeepneyTime + this.walkFromJeepneyTime;
              },
              
              // Modified score to prioritize travel time over distance
              // Lower score is better - prioritize travel time but consider direction
              score: (userRoute.distance * 15) + // Walk to first jeepney 
                     (calculatePolylineDistance(userRoutePath) / 250) + // First jeepney
                     ((transferPoint.distance / 1000) * 20) + // Transfer walk
                     (calculatePolylineDistance(destRoutePath) / 250) + // Second jeepney
                     (destRoute.distance * 15) + // Walk to destination
                     (directionScore / 20) // Direction penalty (reduced weight)
            };
            
            const estimatedTime = (userRoute.distance * 15) + 
                                 (calculatePolylineDistance(userRoutePath) / 250) +
                                 ((transferPoint.distance / 1000) * 20) +
                                 (calculatePolylineDistance(destRoutePath) / 250) +
                                 (destRoute.distance * 15);
            
            console.log(`Found valid transfer from ${userRouteName} to ${destRouteName}, score: ${transferInfo.score}, est. time: ${Math.round(estimatedTime)} mins`);
            transferOptions.push(transferInfo);
          }
        }
      }
      
      // Step 3: Sort transfer options by score (combines distance and directionality)
      transferOptions.sort((a, b) => a.score - b.score);
      
      // Log the best transfer options
      if (transferOptions.length > 0) {
        console.log(`Found ${transferOptions.length} transfer options, showing top 3:`);
        transferOptions.slice(0, Math.min(3, transferOptions.length)).forEach((option, i) => {
          const walkTime = Math.round(option.walkToJeepneyTime + option.transferWalkTime + option.walkFromJeepneyTime);
          const jeepneyTime = Math.round(option.firstJeepneyTime + option.secondJeepneyTime);
          const totalTime = walkTime + jeepneyTime;
          
          console.log(`#${i+1}: From ${option.userRoute.name} to ${option.destRoute.name}, est. time: ${totalTime} mins (score: ${option.score.toFixed(2)})`);
          console.log(`  Walk: ${walkTime} mins, Jeepney: ${jeepneyTime} mins, Transfer: ${Math.round(option.transferWalkTime)} mins`);
          console.log(`  Transfer distance: ${Math.round(option.transferDistance)}m, Direction: ${option.sameDirection ? 'Same' : 'Change'}`);
        });
      }
      
      // If we found at least one valid transfer option
      if (transferOptions.length > 0) {
        const bestTransfer = transferOptions[0];
        
        const userRouteDetails = JEEPNEY_ROUTES_DETAILED[bestTransfer.userRoute.routeId];
        const destRouteDetails = JEEPNEY_ROUTES_DETAILED[bestTransfer.destRoute.routeId];
        
        // Define access points
        const userAccessPoint = {
          latitude: bestTransfer.userRoute.nearestPoint.lat,
          longitude: bestTransfer.userRoute.nearestPoint.lng
        };
        
        const destinationAccessPoint = {
          latitude: bestTransfer.destRoute.nearestPoint.lat,
          longitude: bestTransfer.destRoute.nearestPoint.lng
        };
        
        // Get route paths
        const userRoutePath = bestTransfer.userRoute.pathDetails.via.map(point => ({
          latitude: point.lat,
          longitude: point.lng
        }));
        
        const destRoutePath = bestTransfer.destRoute.pathDetails.via.map(point => ({
          latitude: point.lat,
          longitude: point.lng
        }));
        
        // Get relevant segments for each route
        const userRouteSegment = getRelevantRouteSegment(
          userRoutePath,
          userAccessPoint,
          bestTransfer.transferPoint
        );
        
        const destRouteSegment = getRelevantRouteSegment(
          destRoutePath,
          bestTransfer.transferPoint,
          destinationAccessPoint
        );
        
        // Create walking paths
        const walkToJeepneyPath = [
          { latitude: userLocation.latitude, longitude: userLocation.longitude },
          userAccessPoint
        ];
        
        const walkFromJeepneyPath = [
          destinationAccessPoint,
          { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }
        ];
        
        // Create a transfer walking path (very short since routes are connected)
        const transferWalkPath = [
          userRouteSegment[userRouteSegment.length - 1],
          bestTransfer.transferPoint,
          destRouteSegment[0]
        ];
        
        // Set the jeepney route info
        const jeepneyRouteInfo = {
          ...userRouteDetails,
          name: bestTransfer.userRoute.name,
          type: 'transfer',
          userAccessPoint: userAccessPoint,
          transferPoint: bestTransfer.transferPoint,
          destinationAccessPoint: destinationAccessPoint,
          distance: bestTransfer.userRoute.distance,
          destinationDistance: bestTransfer.destRoute.distance,
          totalWalkingDistance: bestTransfer.totalWalkingDistance,
          transferDistance: bestTransfer.transferPoint.distance, // Distance between routes in meters
          pathPoints: userRoutePath, // First route path
          segmentedPathPoints: userRouteSegment, // Segment of first route
          secondRouteSegment: destRouteSegment, // Segment of second route
          walkToJeepneyPath: walkToJeepneyPath,
          walkFromJeepneyPath: walkFromJeepneyPath,
          transferWalkPath: transferWalkPath,
          transferInfo: {
            routeId: bestTransfer.destRoute.routeId,
            routeName: bestTransfer.destRoute.name,
            pathId: bestTransfer.destRoute.pathId,
            from: bestTransfer.destRoute.pathDetails.from,
            to: bestTransfer.destRoute.pathDetails.to
          }
        };
        
        // Store the route info
        setJeepneyRoute(jeepneyRouteInfo);
        setRoutePath(userRouteSegment); // Set the first route segment as primary
        
        // Set alternative route
        setAlternativeJeepneyRoutes([{
          ...destRouteDetails,
          name: bestTransfer.destRoute.name,
          distance: bestTransfer.destRoute.distance,
          pathId: bestTransfer.destRoute.pathId
        }]);
        
        // Log the coordinates of the transfer route
        console.log("===== TRANSFER ROUTE COORDINATES =====");
        console.log("First route:", userRouteDetails.name);
        console.log("Second route:", destRouteDetails.name);
        console.log("Transfer point:", JSON.stringify(bestTransfer.transferPoint));
        console.log("First route coordinates (start to transfer):");
        userRouteSegment.forEach((point, index) => {
          console.log(`${index}:`, JSON.stringify(point));
        });
        console.log("Transfer walk:");
        transferWalkPath.forEach((point, index) => {
          console.log(`${index}:`, JSON.stringify(point));
        });
        console.log("Second route coordinates (transfer to end):");
        destRouteSegment.forEach((point, index) => {
          console.log(`${index}:`, JSON.stringify(point));
        });
        
        // Fit map to include all route components
        fitMapToRoute([
          ...walkToJeepneyPath,
          ...userRouteSegment,
          ...transferWalkPath,
          ...destRouteSegment,
          ...walkFromJeepneyPath
        ]);
        
        return jeepneyRouteInfo;
      } else {
        // No valid transfers found, inform the user
        Alert.alert(
          "No Connected Routes",
          "Could not find connected jeepney routes for this journey. Consider taking a different mode of transportation."
        );
        
        return null;
      }
    }
    
    // No matching routes found
    console.log("===== NO VALID ROUTES FOUND =====");
    setJeepneyRoute(null);
    setAlternativeJeepneyRoutes([]);
    return null;
  };

  // Find the nearest jeepney route to a location
  const findNearestJeepneyRoute = (location) => {
    if (!location) return null;
    
    let nearestRoute = null;
    let nearestDistance = Infinity;
    let nearestPoint = null;
    let nearestRouteId = null;
    
    // Check each route
    Object.entries(JEEPNEY_ROUTES_DETAILED).forEach(([routeId, routeDetails]) => {
      routeDetails.paths.forEach(path => {
        // Check distance to each point in the path
        path.via.forEach(point => {
          const distance = calculateDistance(
            location.latitude,
            location.longitude,
            point.lat,
            point.lng
          );
          
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestRoute = routeDetails;
            nearestPoint = point;
            nearestRouteId = routeId;
          }
        });
      });
    });
    
    if (nearestRoute && nearestDistance <= 0.5) { // Within 500m
      return {
        route: nearestRoute,
        distance: nearestDistance,
        nearestPoint: nearestPoint,
        routeId: nearestRouteId
      };
    }
    
    return null;
  };

  // Find the nearest jeepney route to destination
  const findNearestJeepneyRouteToDestination = (location) => {
    if (!location) return null;
    
    let nearestRoute = null;
    let nearestDistance = Infinity;
    let nearestPoint = null;
    let nearestRouteId = null;
    
    // Check each route
    Object.entries(JEEPNEY_ROUTES_DETAILED).forEach(([routeId, routeDetails]) => {
      routeDetails.paths.forEach(path => {
        // Check distance to each point in the path
        path.via.forEach(point => {
          const distance = calculateDistance(
            location.latitude,
            location.longitude,
            point.lat,
            point.lng
          );
          
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestRoute = routeDetails;
            nearestPoint = point;
            nearestRouteId = routeId;
          }
        });
      });
    });
    
    if (nearestRoute && nearestDistance <= 0.5) { // Within 500m
      return {
        route: nearestRoute,
        distance: nearestDistance,
        nearestPoint: nearestPoint,
        routeId: nearestRouteId
      };
    }
    
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

  // Modify the fetchDirections function to get both routes
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

      // Regular route fetching for modes
      for (const mode of modes) {
        const apiMode = mode === "tricycle" || mode === "jeepney" ? "driving" : mode;
        
        try {
          const response = await axios.get(
            "https://maps.gomaps.pro/maps/api/directions/json",
            {
              params: {
                origin: `${directionsOrigin.latitude},${directionsOrigin.longitude}`,
                destination: `${selectedLocation.latitude},${selectedLocation.longitude}`,
                key: API_KEY,
                mode: apiMode,
                departure_time: "now",
                alternatives: true
              },
            }
          );

          if (!response.data.routes || response.data.routes.length === 0) {
            console.warn(`No available route found for ${mode}`);
            continue;
          }

          const route = response.data.routes[0];
          const leg = route.legs[0];

          newEta[mode] = leg.duration.text;
          newTrafficDuration[mode] = leg.duration_in_traffic?.text || "N/A";
          setDistance(leg.distance.text);

          if (mode === travelMode) {
            const points = route.overview_polyline.points;
            const decodedRoute = decodePolyline(points);
            setRoutePath(decodedRoute);
            fitMapToRoute(decodedRoute);
          }

          if (response.data?.routes?.[0]?.legs?.[0]?.steps) {
            const steps = response.data.routes[0].legs[0].steps.map(step => ({
              instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
              distance: step.distance.text,
              duration: step.duration.text,
              isInfoLink: step.html_instructions.includes('https://www.commutebacolod.com')
            }));
            setDirections(steps);
          }
        } catch (error) {
          console.error(`Error fetching ${mode} directions:`, error);
        }
      }

      setEta(newEta);
      setTrafficDuration(newTrafficDuration);

    } catch (error) {
      console.error("Error in fetchDirections:", error);
    } finally {
      setFetchingRoute(false);
    }
  };

  // Check if user is on a road and set walk-to-route point if needed
  // Enhanced function to check if user is on a road using reverse geocoding
  const checkUserRoadPosition = async (origin) => {
    try {
      // First approach: Try using reverse geocoding to determine if user is on a road
      const reverseGeoResponse = await axios.get(
        "https://maps.gomaps.pro/maps/api/geocode/json",
        {
          params: {
            latlng: `${origin.latitude},${origin.longitude}`,
            key: API_KEY,
            result_type: "route" // Try to get road information
          },
        }
      );
      
      // Check if we got results indicating a road
      const results = reverseGeoResponse.data?.results || [];
      const isOnRoad = results.some(result => {
        // Check if any of the address components indicate a road
        return result.address_components?.some(component => 
          component.types.includes("route") || 
          component.types.includes("street_address")
        );
      });
      
      if (!isOnRoad) {
        // If not on road, find the nearest road using Roads API
        const nearestRoadResponse = await axios.get(
          "https://maps.gomaps.pro/maps/api/snapToRoads/json",
          {
            params: {
              path: `${origin.latitude},${origin.longitude}`,
              key: API_KEY,
            },
          }
        );
        
        if (nearestRoadResponse.data?.snappedPoints?.length > 0) {
          const snappedPoint = nearestRoadResponse.data.snappedPoints[0].location;
          const roadPoint = {
            latitude: snappedPoint.latitude || snappedPoint.lat,
            longitude: snappedPoint.longitude || snappedPoint.lng
          };
          
          // Calculate distance to nearest road
          const distanceToRoad = calculateDistance(
            origin.latitude,
            origin.longitude,
            roadPoint.latitude,
            roadPoint.longitude
          );
          
          // If user is more than 25 meters from a road, show walk path
          if (distanceToRoad > 0.025) { // 25 meters threshold
            setWalkToRoutePoint(roadPoint);
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
          "https://maps.gomaps.pro/maps/api/directions/json",
          {
            params: {
              origin: `${origin.latitude},${origin.longitude}`,
              destination: `${selectedLocation ? selectedLocation.latitude : origin.latitude + 0.01},${selectedLocation ? selectedLocation.longitude : origin.longitude + 0.01}`,
              key: API_KEY,
              mode: "walking",
            },
          }
        );
        
        if (walkCheckResponse.data?.routes?.[0]?.legs?.[0]?.steps?.length > 0) {
          const firstStep = walkCheckResponse.data.routes[0].legs[0].steps[0];
          
          // If first step is more than 30 meters, user might be off-road
          if (firstStep.distance.value > 30) {
            const walkToPoint = firstStep.end_location;
            setWalkToRoutePoint({
              latitude: walkToPoint.lat,
              longitude: walkToPoint.lng,
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

  // Fetch PWD-friendly route
  const fetchPwdFriendlyRoute = async (origin) => {
    try {
      const response = await axios.get(
        "https://maps.gomaps.pro/maps/api/directions/json",
        {
          params: {
            origin: `${origin.latitude},${origin.longitude}`,
            destination: `${selectedLocation.latitude},${selectedLocation.longitude}`,
            key: API_KEY,
            mode: "walking",
            alternatives: true,
            // PWD-friendly parameters, if supported by API
            avoid: "stairs",
          },
        }
      );

      if (response.data?.routes?.[0]?.overview_polyline) {
        const pwdPoints = response.data.routes[0].overview_polyline.points;
        setPwdRoute(decodePolyline(pwdPoints));
      }
    } catch (error) {
      console.error("Error fetching PWD-friendly route:", error);
    }
  };

  // Fit map to show the route with proper padding
  const fitMapToRoute = (routePoints) => {
    if (!mapRef.current) return;
    
    try {
      let coordinates = [];
      
      // If we're passed an array of coordinates directly, use them
      if (Array.isArray(routePoints) && routePoints.length > 0) {
        coordinates = [...routePoints];
      }
      // Otherwise construct the coordinates from the current route state
      else if (travelMode === "jeepney" && jeepneyRoute) {
        // Add all segments: walking paths, main route, and transfer if it exists
        
        // Walking path to jeepney
        if (jeepneyRoute.walkToJeepneyPath) {
          coordinates = coordinates.concat(jeepneyRoute.walkToJeepneyPath);
        }
        
        // Main jeepney route segment
        if (jeepneyRoute.segmentedPathPoints) {
          coordinates = coordinates.concat(jeepneyRoute.segmentedPathPoints);
        }
        
        // If this is a transfer route, add transfer and second route
        if (jeepneyRoute.type === 'transfer') {
          if (jeepneyRoute.transferWalkPath) {
            coordinates = coordinates.concat(jeepneyRoute.transferWalkPath);
          }
          
          if (jeepneyRoute.secondRouteSegment) {
            coordinates = coordinates.concat(jeepneyRoute.secondRouteSegment);
          }
        }
        
        // Walking path from jeepney to destination
        if (jeepneyRoute.walkFromJeepneyPath) {
          coordinates = coordinates.concat(jeepneyRoute.walkFromJeepneyPath);
        }
        
        // Always include user location and destination for context
        if (userLocation) {
          coordinates.push(userLocation);
        }
        
        if (selectedLocation) {
          coordinates.push(selectedLocation);
        }
      } 
      // For other modes (non-jeepney)
      else {
        coordinates = routePoints ? [...routePoints] : [];
        
        // Include user location and destination for context
        if (userLocation) {
          coordinates.push(userLocation);
        }
        
        if (selectedLocation) {
          coordinates.push(selectedLocation);
        }
        
        if (walkToRoutePoint) {
          coordinates.push(walkToRoutePoint);
        }
      }
      
      // Only fit if we have coordinates
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
    
    // Clear previous route data when changing modes
    setRoutePath([]);
    
    if (mode === "jeepney") {
      if (userLocation && selectedLocation) {
        setFetchingRoute(true);
        
        // Calculate jeepney routes using detailed data - handle async function
        calculateJeepneyRoutes(toLocation)
          .then(jeepneyInfo => {
            if (jeepneyInfo) {
              // Route data is already set in calculateJeepneyRoutes
              // Just set ETA here
              const etaMinutes = Math.round(jeepneyInfo.distance * 20); // Rough estimate: 20 min per km
              const etaText = etaMinutes < 60 
                ? `${etaMinutes} mins` 
                : `${Math.floor(etaMinutes/60)} hr ${etaMinutes % 60} mins`;
              
              const newEta = { ...eta };
              newEta.jeepney = etaText;
              setEta(newEta);
              
              // Create route directions
              const newDirections = [];
              
              // Add walking to jeepney direction
              newDirections.push({
                instruction: `Walk ${Math.round(jeepneyInfo.distance * 1000)}m to nearest ${jeepneyInfo.name} jeepney stop`,
                distance: `${Math.round(jeepneyInfo.distance * 1000)}m`,
                duration: `${Math.round(jeepneyInfo.distance * 15)} mins`
              });
              
              // Add riding direction
              if (jeepneyInfo.type === 'direct') {
                // Direct route
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.name} jeepney to destination`,
                  distance: 'Variable',
                  duration: etaText
                });
              } else if (jeepneyInfo.type === 'circular-route') {
                // Circular route case (destination is "behind" the user in the route)
                const userRouteText = jeepneyInfo.userPathId.includes('_inbound') ? 'inbound' : 'outbound';
                const oppositeRouteText = jeepneyInfo.destPathId.includes('_inbound') ? 'inbound' : 'outbound';
                
                // First leg - ride to the terminal/end
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.name} (${userRouteText}) to the terminal at ${jeepneyInfo.userPath.to}`,
                  distance: 'Variable',
                  duration: `${Math.round(etaMinutes * 0.6)} mins` // Estimate 60% of time
                });
                
                // Transfer instructions
                newDirections.push({
                  instruction: `At the terminal (${jeepneyInfo.userPath.to}), transfer to ${jeepneyInfo.name} (${oppositeRouteText})`,
                  distance: 'Short walk',
                  duration: '2-3 mins'
                });
                
                // Second leg - ride from the beginning of the opposite route
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.name} (${oppositeRouteText}) from ${jeepneyInfo.destPath.from} to destination`,
                  distance: 'Variable',
                  duration: `${Math.round(etaMinutes * 0.4)} mins` // Estimate 40% of time
                });
              } else if (jeepneyInfo.type === 'combined-inout') {
                // Combined inbound/outbound route
                const firstDirectionText = jeepneyInfo.userPathId.includes('_inbound') ? 'inbound' : 'outbound';
                const secondDirectionText = jeepneyInfo.destPathId.includes('_inbound') ? 'inbound' : 'outbound';
                
                // First leg of the journey
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.name} (${firstDirectionText}) to the end of the route at ${jeepneyInfo.userPath.to}`,
                  distance: 'Variable',
                  duration: `${Math.round(etaMinutes * 0.5)} mins` // Estimate 50% of time
                });
                
                // Change to the other direction
                newDirections.push({
                  instruction: `At ${jeepneyInfo.destPath.from}, transfer to ${jeepneyInfo.name} (${secondDirectionText})`,
                  distance: 'Short walk',
                  duration: '1-2 mins'
                });
                
                // Second leg of the journey
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.name} (${secondDirectionText}) to destination`,
                  distance: 'Variable',
                  duration: `${Math.round(etaMinutes * 0.5)} mins` // Estimate 50% of time
                });
              } else if (jeepneyInfo.type === 'transfer') {
                // First route
                const firstRouteTime = Math.round(etaMinutes * 0.4); // 40% of total time estimate
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.name} jeepney to transfer point`,
                  distance: 'Variable',
                  duration: `${firstRouteTime} mins`
                });
                
                // Transfer instructions
                if (jeepneyInfo.transferDistance) {
                  const transferTime = Math.round(jeepneyInfo.transferDistance / 80); // 80m per minute walking
                  newDirections.push({
                    instruction: `Transfer to ${jeepneyInfo.transferInfo.routeName} jeepney (${Math.round(jeepneyInfo.transferDistance)}m walk)`,
                    distance: `${Math.round(jeepneyInfo.transferDistance)}m`,
                    duration: `${transferTime} mins`
                  });
                } else {
                  newDirections.push({
                    instruction: `Transfer to ${jeepneyInfo.transferInfo.routeName} jeepney`,
                    distance: 'Short walk',
                    duration: '2-3 mins'
                  });
                }
                
                // Second route
                const secondRouteTime = Math.round(etaMinutes * 0.4); // 40% of total time estimate
                newDirections.push({
                  instruction: `Ride ${jeepneyInfo.transferInfo.routeName} jeepney to destination`,
                  distance: 'Variable',
                  duration: `${secondRouteTime} mins`
                });
              }
              
              // Walking to final destination
              newDirections.push({
                instruction: 'Walk to final destination',
                distance: 'Short walk',
                duration: '2-5 mins'
              });
              
              setDirections(newDirections);
            }
          })
          .catch(error => {
            console.error("Error calculating jeepney routes:", error);
            Alert.alert("Error", "Could not find a suitable jeepney route for this trip.");
          })
          .finally(() => {
            setFetchingRoute(false);
          });
      }
    } else {
      // For other modes, use Google Maps directions API
      if (userLocation && selectedLocation) {
        fetchDirections(userLocation);
      }
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

  // Decode Google Maps polyline algorithm
  const decodePolyline = (encoded) => {
    let points = [];
    let index = 0,
      lat = 0,
      lng = 0;

    while (index < encoded.length) {
      let b,
        shift = 0,
        result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return points;
  };

  // Helper function to get the full relevant segment of the jeepney route between access points
  const getRelevantRouteSegment = (routePoints, userAccessPoint, destinationAccessPoint, isCombinedRoute = false, userPathPoints = null, destPathPoints = null) => {
    // Handle combined inbound/outbound route case
    if (isCombinedRoute && userPathPoints && destPathPoints) {
      // Find the closest points on each path to access points
      let userAccessIdx = 0;
      let destAccessIdx = 0;
      let minDistUser = Infinity;
      let minDistDest = Infinity;
      
      // Find index of closest point on user path
      userPathPoints.forEach((point, index) => {
        const distUser = calculateDistance(
          point.latitude, 
          point.longitude, 
          userAccessPoint.latitude, 
          userAccessPoint.longitude
        );
        
        if (distUser < minDistUser) {
          minDistUser = distUser;
          userAccessIdx = index;
        }
      });
      
      // Find index of closest point on destination path
      destPathPoints.forEach((point, index) => {
        const distDest = calculateDistance(
          point.latitude, 
          point.longitude, 
          destinationAccessPoint.latitude, 
          destinationAccessPoint.longitude
        );
        
        if (distDest < minDistDest) {
          minDistDest = distDest;
          destAccessIdx = index;
        }
      });
      
      // Create the combined route segment
      let combinedSegment = [];
      
      // Add user access point
      combinedSegment.push(userAccessPoint);
      
      // Add relevant segment from user path (from access point to end)
      const userPathSegment = userPathPoints.slice(userAccessIdx);
      combinedSegment = combinedSegment.concat(userPathSegment);
      
      // Add relevant segment from destination path (from beginning to access point)
      const destPathSegment = destPathPoints.slice(0, destAccessIdx + 1);
      combinedSegment = combinedSegment.concat(destPathSegment);
      
      // Add destination access point
      combinedSegment.push(destinationAccessPoint);
      
      return combinedSegment;
    }
    
    // Regular non-combined route case
    if (!routePoints || !userAccessPoint || !destinationAccessPoint) {
      return [];
    }
    
    // Find the closest points on the route to user access point and destination access point
    let userAccessIdx = 0;
    let destAccessIdx = 0;
    let minDistUser = Infinity;
    let minDistDest = Infinity;
    
    // Find the index of the closest points on the route
    routePoints.forEach((point, index) => {
      // Distance to user access point
      const distUser = calculateDistance(
        point.latitude, 
        point.longitude, 
        userAccessPoint.latitude, 
        userAccessPoint.longitude
      );
      
      // Distance to destination access point
      const distDest = calculateDistance(
        point.latitude, 
        point.longitude, 
        destinationAccessPoint.latitude, 
        destinationAccessPoint.longitude
      );
      
      if (distUser < minDistUser) {
        minDistUser = distUser;
        userAccessIdx = index;
      }
      
      if (distDest < minDistDest) {
        minDistDest = distDest;
        destAccessIdx = index;
      }
    });
    
    // Create the complete route segment
    let relevantSegment = [];
    
    // Add walking path from user location to nearest route point
    relevantSegment.push(userAccessPoint);
    
    // Extract the route points in the correct order
    if (userAccessIdx <= destAccessIdx) {
      // Forward direction
      relevantSegment = relevantSegment.concat(routePoints.slice(userAccessIdx, destAccessIdx + 1));
    } else {
      // Reverse direction (need to go backwards on the route)
      relevantSegment = relevantSegment.concat(routePoints.slice(destAccessIdx, userAccessIdx + 1).reverse());
    }
    
    // Add the destination access point
    relevantSegment.push(destinationAccessPoint);
    
    return relevantSegment;
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
    JEEPNEY_ROUTES_DETAILED.forEach(route => {
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
    return JEEPNEY_ROUTES_DETAILED.filter(route => 
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
    if (!route) return "N/A";
    
    // For direct routes
    if (route.directRoute) {
      return route.landmarks ? route.landmarks.length * 5 : Math.round((route.distance * 1000) / 250) + " min"; // ~250m per minute as average walking pace
    }
    
    // For transfer routes
    if (route.type === 'transfer') {
      // Calculate time for first route - assume average jeepney speed of 15km/h
      const firstRouteTime = Math.round((route.distance * 1000) / 250); // time to walk to first route
      
      // Calculate time for first route portion - jeepney travels at ~15km/h = 250m/min
      const firstJeepneyTime = route.segmentedPathPoints ? Math.round(calculatePolylineDistance(route.segmentedPathPoints) / 250) : 10;
      
      // Calculate time for transfer
      const transferTime = route.transferDistance ? Math.round(route.transferDistance / 80) : 1; // 80m/min slower walking pace during transfer
      
      // Calculate time for second route portion
      const secondJeepneyTime = route.secondRouteSegment ? Math.round(calculatePolylineDistance(route.secondRouteSegment) / 250) : 10;
      
      // Calculate time to walk from second route to destination
      const finalWalkTime = route.destinationDistance ? Math.round((route.destinationDistance * 1000) / 250) : 5;
      
      return (firstRouteTime + firstJeepneyTime + transferTime + secondJeepneyTime + finalWalkTime) + " min";
    }
    
    // Fallback
    return Math.round((route.distance * 1000) / 250) + " min";
  };

  // Calculate total distance of a polyline path
  const calculatePolylineDistance = (points) => {
    if (!points || points.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const point1 = points[i];
      const point2 = points[i + 1];
      totalDistance += calculateDistance(
        point1.latitude || point1.lat,
        point1.longitude || point1.lng,
        point2.latitude || point2.lat,
        point2.longitude || point2.lng
      ) * 1000; // Convert to meters
    }
    
    return totalDistance;
  };

  // Function to find routes by type of landmark
  const findRoutesByLandmarkType = (type) => {
    return JEEPNEY_ROUTES_DETAILED.filter(route => 
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
      return JEEPNEY_ROUTES_DETAILED.filter(alt => 
        alt.name !== route.name && 
        hasCommonDestination(alt, route) &&
        !isRouteCongested(alt, time)
      );
    }
    
    return [];
  };

  // Update the clearSearch function
  const clearSearch = () => {
    // Clear search and location data
    setQuery("");
    setPlaces([]);
    setSelectedLocation(null);
    setToLocation("");
    
    // Clear all route data
    setRoutePath([]);
    setDirections([]);
    setDistance(null);
    setEta({});
    setTrafficDuration({});
    
    // Clear jeepney route data
    setJeepneyRoute(null);
    setAlternativeJeepneyRoutes([]);
    setNearestStop(null);
    setSuggestedRoutes([]);
    
    // Reset travel mode
    setTravelMode("driving");
    
    // Reset map to user location
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
  };

  // Create a direct route from user location to destination using jeepney routes
  const createDirectJeepneyRoute = (userLocation, destination, jeepneyRouteData) => {
    if (!userLocation || !destination || !jeepneyRouteData) {
      return [];
    }
    
    // If no path points data is available, return empty route
    if (!jeepneyRouteData.pathPoints || jeepneyRouteData.pathPoints.length === 0 || 
        !jeepneyRouteData.userAccessPoint || !jeepneyRouteData.destinationAccessPoint) {
      return [];
    }
    
    // Find the closest points on the actual route
    let startIdx = -1;
    let endIdx = -1;
    let minStartDist = Infinity;
    let minEndDist = Infinity;
    
    // Find the closest points on the actual route to our access points
    jeepneyRouteData.pathPoints.forEach((point, index) => {
      // Distance to user access point
      const startDist = calculateDistance(
        point.latitude,
        point.longitude,
        jeepneyRouteData.userAccessPoint.latitude,
        jeepneyRouteData.userAccessPoint.longitude
      );
      
      // Distance to destination access point
      const endDist = calculateDistance(
        point.latitude,
        point.longitude,
        jeepneyRouteData.destinationAccessPoint.latitude,
        jeepneyRouteData.destinationAccessPoint.longitude
      );
      
      if (startDist < minStartDist) {
        minStartDist = startDist;
        startIdx = index;
      }
      
      if (endDist < minEndDist) {
        minEndDist = endDist;
        endIdx = index;
      }
    });
    
    // If we didn't find valid indices, return empty route
    if (startIdx === -1 || endIdx === -1) {
      return [];
    }
    
    // Make sure we get the segment in the correct direction
    if (startIdx > endIdx) {
      [startIdx, endIdx] = [endIdx, startIdx];
    }
    
    // Extract only the segment between the two points
    // Include a small buffer (e.g., 2 points on each side) to make sure the route looks natural
    const startIdxWithBuffer = Math.max(0, startIdx);
    const endIdxWithBuffer = Math.min(jeepneyRouteData.pathPoints.length - 1, endIdx);
    
    return jeepneyRouteData.pathPoints.slice(startIdxWithBuffer, endIdxWithBuffer + 1);
  };

  // Find all jeepney routes within a specified radius
  const findJeepneyRoutesWithinRadius = (location, radiusKm, isUserLocation = false, destination = null) => {
    if (!location) return [];
    
    let routesWithinRadius = [];
    
    // Check each route
    Object.entries(JEEPNEY_ROUTES_DETAILED).forEach(([routeId, routeDetails]) => {
      // Check all paths in the route (inbound and outbound)
      routeDetails.paths.forEach((path, pathIndex) => {
        // Check each point in the path
        let foundWithinRadius = false;
        let closestPoint = null;
        let minDistance = Infinity;
        let pointIndex = -1;  // Track the index of the closest point
        
        // Check all points in the current path
        for (let i = 0; i < path.via.length; i++) {
          const point = path.via[i];
          const distance = calculateDistance(
            location.latitude,
            location.longitude,
            point.lat,
            point.lng
          );
          
          // Keep track of the closest point in this path
          if (distance < minDistance) {
            minDistance = distance;
            closestPoint = point;
            pointIndex = i;
          }
          
          // If this point is within radius, mark as found
          if (distance <= radiusKm) {
            foundWithinRadius = true;
            // Don't break here, continue to find the closest point within radius
          }
        }
        
        // If we found a point within radius for this path, add it to results
        if (foundWithinRadius && closestPoint) {
            const routeEntry = {
              route: routeDetails,
              distance: minDistance,
              nearestPoint: closestPoint,
              routeId: routeId,
              pathId: path.pathId,
              pathIndex: pathIndex,
              from: path.from,
              to: path.to,
              pointIndex: pointIndex  // Store the index of this point in the path
            };
            
            // If we're checking for a user location and a destination is provided,
            // verify the directional relationship
            if (isUserLocation && destination) {
              // Find where the destination falls in this same path
              let destClosestPoint = null;
              let destMinDistance = Infinity;
              let destPointIndex = -1;
              
              for (let i = 0; i < path.via.length; i++) {
                const point = path.via[i];
                const distance = calculateDistance(
                  destination.latitude,
                  destination.longitude,
                  point.lat,
                  point.lng
                );
                
                if (distance < destMinDistance) {
                  destMinDistance = distance;
                  destClosestPoint = point;
                  destPointIndex = i;
                }
                
                // Only consider the destination if it's within our search radius
                if (distance <= radiusKm && destPointIndex >= 0) {
                  // Store the relative position info
                  routeEntry.destinationPointIndex = destPointIndex;
                  
                  // Calculate if user is before destination in the route sequence
                  routeEntry.userBeforeDestination = pointIndex < destPointIndex;
                  
                  // Set a directionality score - lower is better
                  if (pointIndex < destPointIndex) {
                    // Optimal: user is before destination
                    routeEntry.directionalScore = 0;
                  } else if (pointIndex > destPointIndex) {
                    // Suboptimal: user is after destination 
                    routeEntry.directionalScore = 1000 + (pointIndex - destPointIndex);
                  } else {
                    // Same point (unlikely but possible)
                    routeEntry.directionalScore = 500;
                  }
                }
              }
            }
            
            routesWithinRadius.push(routeEntry);
        }
      });
      
      // Add combined route entries for inbound/outbound paths of the same route
      if (routeDetails.paths.length >= 2) {
        // Look for combinations of inbound and outbound paths
        const inboundPath = routeDetails.paths.find(p => p.pathId.includes('_inbound'));
        const outboundPath = routeDetails.paths.find(p => p.pathId.includes('_outbound'));
        
        if (inboundPath && outboundPath) {
          let closestPoint = null;
          let minDistance = Infinity;
          let foundWithinRadius = false;
          let pathId = null;
          let pointIndex = -1;
          
          // Check all points in both paths
          const allPoints = [...inboundPath.via, ...outboundPath.via];
          
          for (let i = 0; i < allPoints.length; i++) {
            const point = allPoints[i];
            const distance = calculateDistance(
              location.latitude,
              location.longitude,
              point.lat,
              point.lng
            );
            
            // Keep track of the closest point across both paths
            if (distance < minDistance) {
              minDistance = distance;
              closestPoint = point;
              pointIndex = i;
              
              // Determine which path this point belongs to
              const isInbound = inboundPath.via.some(p => p.lat === point.lat && p.lng === point.lng);
              pathId = isInbound ? inboundPath.pathId : outboundPath.pathId;
            }
            
            // If this point is within radius, mark as found
            if (distance <= radiusKm) {
              foundWithinRadius = true;
            }
          }
          
          // If we found a point within radius, add the combined route info
          if (foundWithinRadius && closestPoint) {
            routesWithinRadius.push({
              route: routeDetails,
              distance: minDistance,
              nearestPoint: closestPoint,
              routeId: routeId,
              pathId: pathId, // The path where the closest point was found
              pointIndex: pointIndex,
              combinedRoute: true, // Flag that this is a combined route consideration
              inboundPath: inboundPath,
              outboundPath: outboundPath,
              from: inboundPath.from, // Starting point of inbound
              to: outboundPath.to    // End point of outbound
            });
          }
        }
      }
    });
    
    // Sort by directional score first (if available), then by distance
    routesWithinRadius.sort((a, b) => {
      if (a.directionalScore !== undefined && b.directionalScore !== undefined) {
        if (a.directionalScore !== b.directionalScore) {
          return a.directionalScore - b.directionalScore; // Lower score is better
        }
      }
      return a.distance - b.distance; // If scores are equal, prioritize by distance
    });
    
    return routesWithinRadius;
  };

  // Comprehensive web scraping function for CommuteBarolod website
  // NOTE: Only use this if you have permission from the website owner
  const scrapeCommuteBarolodData = async (routeId) => {
    try {
      // Show loading state
      setIsScrapingData(true);
      
      // Import cheerio (you'll need to add this to your imports)
      // import * as cheerio from 'cheerio-without-node-native';
      
      // 1. Fetch the HTML content of the page
      console.log(`Fetching data for route: ${routeId}`);
      const response = await axios.get(
        `https://www.commutebacolod.com/routes/${routeId}`,
        {
          headers: {
            // Setting a user agent helps prevent blocking
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml'
          }
        }
      );
      
      // 2. Load HTML content with cheerio
      // const $ = cheerio.load(response.data);
      
      // 3. Extract route information - these are examples and would need to be adjusted
      // based on the actual HTML structure of CommuteBarolod.com
      /*
      const routeName = $('.route-name').text().trim();
      
      // Extract stops along the route
      const stops = [];
      $('.stop-item').each((i, el) => {
        stops.push({
          name: $(el).find('.stop-name').text().trim(),
          location: {
            lat: parseFloat($(el).attr('data-lat')),
            lng: parseFloat($(el).attr('data-lng'))
          }
        });
      });
      
      // Extract schedule information
      const schedule = {
        weekdays: $('.schedule-weekday').text().trim(),
        weekends: $('.schedule-weekend').text().trim()
      };
      
      // Extract fare information
      const fareInfo = {
        regular: $('.fare-regular').text().trim().replace('₱', ''),
        student: $('.fare-student').text().trim().replace('₱', ''),
        senior: $('.fare-senior').text().trim().replace('₱', '')
      };
      
      // Return structured data
      return {
        routeName,
        stops,
        schedule,
        fareInfo,
        sourceUrl: `https://www.commutebacolod.com/routes/${routeId}`
      };
      */
      
      // For demonstration purposes, we'll parse some basic information
      // In reality, you'd need to inspect the page structure and adjust selectors
      console.log('HTML content fetched, length:', response.data.length);
      
      // Parse with regex as a simple alternative (not as robust as cheerio)
      const titleMatch = response.data.match(/<title>(.*?)<\/title>/i);
      const routeName = titleMatch ? titleMatch[1].split('|')[0].trim() : 'Unknown Route';
      
      // Look for route description
      const descriptionMatch = response.data.match(/<meta name="description" content="(.*?)"/i);
      const description = descriptionMatch ? descriptionMatch[1] : 'No description available';
      
      // Create data object
      const data = {
        routeName,
        description,
        sourceUrl: `https://www.commutebacolod.com/routes/${routeId}`,
        raw: response.data.substring(0, 200) + '...' // First 200 chars for debugging
      };
      
      // Store the scraped data in state
      setScrapedData(data);
      
      // Show the modal
      setShowScrapedDataModal(true);
      
      return data;
    } catch (error) {
      console.error('Error scraping CommuteBarolod website:', error);
      Alert.alert(
        "Error",
        "Failed to fetch data from CommuteBarolod website. Would you like to visit the website directly?",
        [
          {
            text: "Cancel",
            style: "cancel"
          },
          {
            text: "Visit Website",
            onPress: () => Linking.openURL(`https://www.commutebacolod.com/routes/${routeId || ''}`)
          }
        ]
      );
      return null;
    } finally {
      // Hide loading state
      setIsScrapingData(false);
    }
  };

  // Find a transfer point between two jeepney routes
  const findTransferPoint = (route1Points, route2Points, routeId1 = null, routeId2 = null) => {
    if (!route1Points || !route1Points.length || !route2Points || !route2Points.length) {
      return null;
    }
    
    // Maximum distance for a valid transfer (300m = 0.3km)
    const MAX_TRANSFER_DISTANCE = 0.3;
    let closestDistance = Infinity;
    let transferPoint = null;
    let route1Point = null;
    let route2Point = null;
    let route1Index = -1;
    let route2Index = -1;
    
    // Special case for Banago-Libertad routes
    const isBanagoLibertad = routeId1 === "1" && routeId2 === "1";
    
    // Find the closest points between the two routes
    route1Points.forEach((point1, idx1) => {
      route2Points.forEach((point2, idx2) => {
        const distance = calculateDistance(
          point1.latitude, 
          point1.longitude,
          point2.latitude,
          point2.longitude
        );
        
        if (distance < closestDistance) {
          closestDistance = distance;
          route1Point = point1;
          route2Point = point2;
          route1Index = idx1;
          route2Index = idx2;
        }
      });
    });
    
    // Only consider routes as connected if they come within MAX_TRANSFER_DISTANCE of each other
    // For Banago-Libertad, we'll be more permissive to allow transfers between inbound/outbound
    const maxAllowedDistance = isBanagoLibertad ? 0.5 : MAX_TRANSFER_DISTANCE;
    
    if (closestDistance <= maxAllowedDistance) {
      // Use midpoint between closest points as transfer point
      transferPoint = {
        latitude: (route1Point.latitude + route2Point.latitude) / 2,
        longitude: (route1Point.longitude + route2Point.longitude) / 2,
        distance: closestDistance * 1000, // Convert to meters for display
        route1Index: route1Index,
        route2Index: route2Index
      };
    }
    
    return transferPoint;
  };

  // Add a helper function to display route accessibility info for PWD users
  const getRouteAccessibilityInfo = (route) => {
    if (!route || !route.isPwdFriendly) return null;
    
    let accessibilityFeatures = [];
    
    // Add accessibility feature regarding walking distance
    if (route.totalWalkingDistance) {
      const walkingDistanceMeters = Math.round(route.totalWalkingDistance * 1000);
      
      if (walkingDistanceMeters < 300) {
        accessibilityFeatures.push({
          icon: "footsteps",
          color: "#4CAF50",
          text: "Minimal walking distance (less than 300m total)"
        });
      } else if (walkingDistanceMeters < 500) {
        accessibilityFeatures.push({
          icon: "walk",
          color: "#FFC107",
          text: "Moderate walking required (less than 500m total)"
        });
      } else {
        accessibilityFeatures.push({
          icon: "warning",
          color: "#FF5722",
          text: "Significant walking required"
        });
      }
    }
    
    // Add transfer info for accessibility
    if (route.type === 'transfer') {
      if (route.transferDistance < 50) {
        accessibilityFeatures.push({
          icon: "swap-horizontal",
          color: "#4CAF50",
          text: "Easy transfer (less than 50m)"
        });
      } else if (route.transferDistance < 100) {
        accessibilityFeatures.push({
          icon: "swap-horizontal",
          color: "#FFC107",
          text: "Moderate transfer distance"
        });
      } else {
        accessibilityFeatures.push({
          icon: "swap-horizontal",
          color: "#FF5722",
          text: "Long transfer distance"
        });
      }
    }
    
    // Add direct route benefit
    if (route.type === 'direct') {
      accessibilityFeatures.push({
        icon: "checkmark-circle",
        color: "#4CAF50",
        text: "Direct route (no transfers required)"
      });
    }
    
    return accessibilityFeatures;
  };

  const getRouteColor = (routeName) => {
    // Different shades of green
    if (routeName.includes('Banago')) return '#2E8B57';  // Sea Green
    if (routeName.includes('Northbound')) return '#3CB371';  // Medium Sea Green
    if (routeName.includes('Tangub')) return '#20B2AA';  // Light Sea Green
    if (routeName.includes('Airport')) return '#32CD32';  // Lime Green
    if (routeName.includes('Mandalagan')) return '#66CDAA';  // Medium Aquamarine
    if (routeName.includes('Bata')) return '#98FB98';  // Pale Green
    if (routeName.includes('Alangilan')) return '#00FA9A';  // Spring Green
    if (routeName.includes('Sum-ag')) return '#7CFC00';  // Lawn Green
    return '#2E8B57';  // Default to Sea Green
  };

  const renderJeepneyRoutesModal = () => (
    <Modal
      visible={showJeepneyRoutesModal}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowJeepneyRoutesModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleContainer}>
              <View style={[styles.iconContainer, { backgroundColor: '#2E8B57' }]}>
                <Ionicons name="bus" size={28} color="white" />
              </View>
              <Text style={styles.modalTitle}>Jeepney Routes</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setShowJeepneyRoutesModal(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close-circle" size={28} color="#2E8B57" />
            </TouchableOpacity>
          </View>
          
          <ScrollView 
            style={styles.routesList}
            showsVerticalScrollIndicator={false}
          >
            {Object.entries(JEEPNEY_ROUTES_DETAILED).map(([id, route]) => {
              const routeColor = getRouteColor(route.name);
              return (
                <TouchableOpacity 
                  key={id}
                  style={[styles.routeCard, { borderLeftColor: routeColor, borderLeftWidth: 4 }]}
                  activeOpacity={0.7}
                >
                  <View style={styles.routeCardContent}>
                    <View style={[styles.routeIconContainer, { backgroundColor: `${routeColor}20` }]}>
                      <Ionicons name="bus" size={24} color={routeColor} />
                    </View>
                    <View style={styles.routeInfo}>
                      <Text style={styles.routeName}>{route.name}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Map View */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: userLocation?.latitude || 10.6765,
            longitude: userLocation?.longitude || 122.9509,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          {/* User location marker */}
          {userLocation && (
            <Marker coordinate={userLocation} title="You">
              <View style={styles.userMarker}>
                <View style={styles.userMarkerInner}>
                  <View style={styles.userMarkerDot} />
                </View>
              </View>
            </Marker>
          )}
          
          {/* Destination marker */}
          {selectedLocation && (
            <Marker 
              coordinate={selectedLocation} 
              title="Destination"
            >
              <View style={styles.destinationMarker}>
                <View style={styles.destinationMarkerInner}>
                  <Ionicons name="location" size={12} color="#fff" />
                </View>
              </View>
            </Marker>
          )}
          
          {/* Jeepney Route */}
          {travelMode === "jeepney" && jeepneyRoute && (
            <>
              {/* Walk to Jeepney Route Path */}
              {jeepneyRoute.walkToJeepneyPath && (
                <Polyline
                  coordinates={jeepneyRoute.walkToJeepneyPath}
                  strokeWidth={4}
                  strokeColor="#666666"
                  lineDashPattern={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={0}
                />
              )}
              
              {/* Main Jeepney Route Line */}
              <Polyline 
                coordinates={jeepneyRoute.segmentedPathPoints}
                strokeWidth={6}
                strokeColor="#FFC107"
                lineDashPattern={[0]}
                lineCap="round"
                lineJoin="round"
                zIndex={1}
                strokePattern={[
                  { color: '#FFC107', width: 6 },
                  { color: '#ffd54f', width: 6 }
                ]}
              />
              
              {/* Second Route Segment (for transfers) */}
              {jeepneyRoute.type === 'transfer' && jeepneyRoute.secondRouteSegment && (
                <Polyline
                  coordinates={jeepneyRoute.secondRouteSegment}
                  strokeWidth={6}
                  strokeColor="#4CAF50"
                  lineDashPattern={[0]}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={1}
                  strokePattern={[
                    { color: '#4CAF50', width: 6 },
                    { color: '#81c784', width: 6 }
                  ]}
                />
              )}
              
              {/* Transfer Walk Path */}
              {jeepneyRoute.type === 'transfer' && jeepneyRoute.transferWalkPath && (
                <Polyline
                  coordinates={jeepneyRoute.transferWalkPath}
                  strokeWidth={4}
                  strokeColor="#FF5722"
                  lineDashPattern={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={0}
                />
              )}
              
              {/* Walk from Jeepney to Destination */}
              {jeepneyRoute.walkFromJeepneyPath && (
                <Polyline
                  coordinates={jeepneyRoute.walkFromJeepneyPath}
                  strokeWidth={4}
                  strokeColor="#666666"
                  lineDashPattern={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={0}
                />
              )}
              
              {/* Route Label */}
              {jeepneyRoute.userAccessPoint && jeepneyRoute.destinationAccessPoint && (
                <Marker
                  coordinate={{
                    latitude: (jeepneyRoute.userAccessPoint.latitude + jeepneyRoute.destinationAccessPoint.latitude) / 2,
                    longitude: (jeepneyRoute.userAccessPoint.longitude + jeepneyRoute.destinationAccessPoint.longitude) / 2
                  }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  flat={true}
                >
                  <View style={styles.routeLabel}>
                    <Text style={styles.routeLabelText}>{jeepneyRoute.name || "Jeepney Route"}</Text>
                  </View>
                </Marker>
              )}
              
              {/* Transfer Label (if applicable) */}
              {jeepneyRoute.type === 'transfer' && jeepneyRoute.transferPoint && (
                <Marker
                  coordinate={jeepneyRoute.transferPoint}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={styles.transferMarker}>
                    <Ionicons name="swap-horizontal" size={16} color="#fff" />
                  </View>
                  <Callout tooltip>
                    <View style={styles.transferCallout}>
                      <Text style={styles.transferCalloutTitle}>Transfer Point</Text>
                      <Text style={styles.transferCalloutText}>
                        From: {jeepneyRoute.name}
                      </Text>
                      <Text style={styles.transferCalloutText}>
                        To: {jeepneyRoute.transferInfo?.routeName || "second route"}
                      </Text>
                      {jeepneyRoute.transferDistance && (
                        <Text style={styles.transferCalloutDistance}>
                          {Math.round(jeepneyRoute.transferDistance)}m walking distance
                        </Text>
                      )}
                    </View>
                  </Callout>
                </Marker>
              )}
              
              {/* User Access Point Marker */}
              {jeepneyRoute.userAccessPoint && (
                <Marker 
                  coordinate={jeepneyRoute.userAccessPoint}
                  title="Nearest Jeepney Access Point"
                >
                  <View style={styles.jeepneyAccessMarker}>
                    <Ionicons name="bus" size={12} color="#fff" />
                  </View>
                </Marker>
              )}
              
              {/* Destination Access Point */}
              {jeepneyRoute.destinationAccessPoint && (
                <Marker 
                  coordinate={jeepneyRoute.destinationAccessPoint}
                  title="Jeepney Stop at Destination"
                >
                  <View style={styles.jeepneyAccessMarker}>
                    <Ionicons name="bus" size={12} color="#fff" />
                  </View>
                </Marker>
              )}
            </>
          )}
            
            {/* Regular route */}
            {travelMode !== "jeepney" && routePath.length > 0 && (
              <Polyline 
                coordinates={routePath}
                strokeWidth={6}
                strokeColor="#007bff"
                lineDashPattern={[0]}
                lineCap="round"
                lineJoin="round"
                zIndex={1}
                strokePattern={[
                  { color: '#007bff', width: 6 },
                  { color: '#4da3ff', width: 6 }
                ]}
              />
            )}
            
            {/* Walk to route polyline with label */}
            {walkToRoutePoint && userLocation && travelMode !== "jeepney" && (
              <>
                <Polyline
                  coordinates={[userLocation, walkToRoutePoint]}
                  strokeWidth={4}
                  strokeColor="#666666"
                  lineDashPattern={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={0}
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
      </View>

      {/* Scraped Data Modal */}
      <Modal
        visible={showScrapedDataModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowScrapedDataModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.titleContainer}>
                <Ionicons name="globe-outline" size={20} color="#007bff" />
                <Text style={styles.modalTitle}>
                  {scrapedData?.routeName || "Route Information"}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={() => setShowScrapedDataModal(false)}
              >
                <Ionicons name="close-circle" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {isScrapingData ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#007bff" />
                  <Text style={styles.loadingText}>Fetching route data...</Text>
                </View>
              ) : (
                <>
                  <View style={styles.infoCard}>
                    <Text style={styles.modalSubtitle}>Description</Text>
                    <Text style={styles.modalText}>{scrapedData?.description || "No description available"}</Text>
                  </View>
                  
                  {/* Could add more structured data here as it becomes available */}
                  
                  <View style={styles.noteCard}>
                    <View style={styles.noteIcon}>
                      <Ionicons name="information-circle" size={16} color="#666" />
                    </View>
                    <Text style={styles.modalNote}>
                      Data extracted from CommuteBarolod website. For complete and updated information,
                      please visit the official website.
                    </Text>
                  </View>
                  
                  <TouchableOpacity
                    style={styles.visitWebsiteButton}
                    onPress={() => {
                      setShowScrapedDataModal(false);
                      Linking.openURL(scrapedData?.sourceUrl || 'https://www.commutebacolod.com');
                    }}
                  >
                    <Text style={styles.visitWebsiteButtonText}>Visit CommuteBarolod Website</Text>
                    <Ionicons name="open-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Main content container */}
      <View style={styles.contentContainer}>
        {/* Search bar */}
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
              <View style={styles.inputActions}>
                {query.length > 0 && (
                  <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
                    <Ionicons name="close-circle" size={20} color="#888" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

          </View>
          {loading && <ActivityIndicator size="small" color="#007bff" style={styles.loading} />}
        </View>

        {/* Search Results */}
        {places.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
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
            />
          </View>
        )}

        {/* Scrollable content */}
        <ScrollView 
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Route Info Section */}
          <View style={styles.routeInfoSection}>
            <View style={styles.infoContainer}>
              <View style={styles.infoItem}>
                <Ionicons name="time-outline" size={20} color="#666" />
                <Text style={styles.infoLabel}>ETA</Text>
                <Text style={styles.infoValue}>
                  {fetchingRoute ? "Calculating..." : eta[travelMode] || "N/A"}
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="speedometer-outline" size={20} color="#666" />
                <Text style={styles.infoLabel}>Distance</Text>
                <Text style={styles.infoValue}>
                  {fetchingRoute ? "Calculating..." : distance || "N/A"}
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="car-outline" size={20} color="#666" />
                <Text style={styles.infoLabel}>Traffic</Text>
                <Text style={[
                  styles.infoValue,
                  trafficDuration[travelMode]?.toLowerCase().includes('light') && styles.trafficLight,
                  trafficDuration[travelMode]?.toLowerCase().includes('moderate') && styles.trafficModerate,
                  trafficDuration[travelMode]?.toLowerCase().includes('heavy') && styles.trafficHeavy,
                ]}>
                  {fetchingRoute ? "Calculating..." : 
                   trafficDuration[travelMode] ? 
                   (() => {
                     const traffic = trafficDuration[travelMode].toLowerCase();
                     if (traffic.includes('light')) return 'Light';
                     if (traffic.includes('moderate')) return 'Moderate';
                     if (traffic.includes('heavy')) return 'Heavy';
                     return 'N/A';
                   })() : 
                   "N/A"}
                </Text>
              </View>
            </View>
          </View>

          {/* Transport Mode Section */}
          <View style={styles.transportSection}>
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
                    size={20} 
                    color={travelMode === mode ? "#fff" : "#007bff"} 
                  />
                  <Text style={[
                    styles.modeButtonText,
                    travelMode === mode && styles.activeModeButtonText,
                  ]}>
                    {mode === "book-ride" ? "Book Ride" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Get Directions Button */}
            <TouchableOpacity
              style={styles.getDirectionsButton}
              onPress={() => fetchDirections(userLocation)}
              disabled={fetchingRoute || !userLocation || !selectedLocation}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.getDirectionsButtonText}>
                {fetchingRoute ? "Calculating..." : "Get Directions"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Directions Section */}
          {directions.length > 0 && (
            <View style={styles.directionsSection}>
              <View style={styles.directionsPanel}>
                {directions.slice(0, 3).map((step, index) => (
                  <View key={index} style={styles.directionStep}>
                    <View style={styles.directionStepNumber}>
                      <Text style={styles.stepNumberText}>{index + 1}</Text>
                    </View>
                    <View style={styles.directionStepContent}>
                      <Text style={styles.directionText} numberOfLines={2}>
                        {step.instruction}
                      </Text>
                      <Text style={styles.directionMetrics}>
                        {step.distance} {step.duration ? `• ${step.duration}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
                
                {/* Show CommuteBarolod reference if available in directions */}
                {directions.some(step => step.isInfoLink) && (
                  <TouchableOpacity 
                    style={styles.commuteBarolodButton}
                    onPress={() => {
                      const infoStep = directions.find(step => step.isInfoLink);
                      if (infoStep && infoStep.infoUrl) {
                        Linking.openURL(infoStep.infoUrl);
                      } else {
                        Linking.openURL('https://www.commutebacolod.com');
                      }
                    }}
                  >
                    <View style={styles.commuteBarolodIcon}>
                      <Ionicons name="information-circle" size={20} color="#fff" />
                    </View>
                    <Text style={styles.commuteBarolodText}>
                      View detailed route information on CommuteBarolod
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#007bff" />
                  </TouchableOpacity>
                )}
                
                {directions.length > 3 && (
                  <TouchableOpacity 
                    style={styles.viewMoreButton}
                    onPress={() => alert("Show full directions")}
                  >
                    <Text style={styles.viewMoreText}>View All Steps</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
          
          {/* Jeepney Route Details Section */}
          {travelMode === "jeepney" && jeepneyRoute && (
            <View style={styles.directionsSection}>
              <View style={styles.jeepneyRouteInfo}>
                <View style={styles.jeepneyRouteHeader}>
                  <Ionicons name="bus" size={20} color="#FFC107" />
                  <Text style={styles.jeepneyRouteName}>{jeepneyRoute.name}</Text>
                </View>
                
                <View style={styles.directionBadgeContainer}>
                  <View style={styles.directionBadge}>
                    <Text style={styles.directionBadgeText}>
                      {jeepneyRoute.from} → {jeepneyRoute.to}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.jeepneyRouteDetail}>
                  <Ionicons name="walk" size={16} color="#666" />
                  <Text style={styles.jeepneyRouteDetailText}>
                    Walk {Math.round(jeepneyRoute.distance * 1000)}m to nearest jeepney route
                  </Text>
                </View>
                
                <View style={styles.jeepneyRouteDetail}>
                  <Ionicons name="time" size={16} color="#666" />
                  <Text style={styles.jeepneyRouteDetailText}>
                    Est. travel time: {eta.jeepney || "N/A"}
                  </Text>
                </View>
                
                <View style={styles.jeepneyRouteDetail}>
                  <Ionicons name="cash" size={16} color="#666" />
                  <Text style={styles.jeepneyRouteDetailText}>
                    Fare: ₱12.00 - ₱20.00 (estimated)
                  </Text>
                </View>
                
                {jeepneyRoute.type === 'transfer' && (
                  <View style={styles.jeepneyRouteTransfer}>
                    <View style={styles.jeepneyRouteHeader}>
                      <Ionicons name="swap-horizontal" size={16} color="#FF5722" />
                      <Text style={styles.jeepneyRouteTransferTitle}>
                        Transfer Information
                      </Text>
                    </View>
                    
                    <View style={styles.jeepneyRouteDetail}>
                      <Ionicons name="location" size={16} color="#666" />
                      <Text style={styles.jeepneyRouteDetailText}>
                        Transfer to: {jeepneyRoute.transferInfo.routeName}
                      </Text>
                    </View>
                    
                    <View style={styles.directionBadgeContainer}>
                      <View style={[styles.directionBadge, styles.transferDirectionBadge]}>
                        <Text style={styles.directionBadgeText}>
                          {jeepneyRoute.transferInfo.from} → {jeepneyRoute.transferInfo.to}
                        </Text>
                      </View>
                    </View>
                    
                    {jeepneyRoute.transferDistance && (
                      <View style={styles.jeepneyRouteDetail}>
                        <Ionicons name="resize" size={16} color="#666" />
                        <Text style={styles.jeepneyRouteDetailText}>
                          Transfer walking distance: {Math.round(jeepneyRoute.transferDistance)}m
                        </Text>
                      </View>
                    )}
                    
                    {/* Add ETA information for each segment */}
                    <View style={styles.segmentDetails}>
                      <View style={styles.segmentDetail}>
                        <Ionicons name="bus-outline" size={16} color="#FFC107" />
                        <Text style={styles.segmentDetailText}>
                          First route: ~{Math.round(calculatePolylineDistance(jeepneyRoute.segmentedPathPoints) / 1000).toFixed(1)}km
                          {" • "}~{Math.round(calculatePolylineDistance(jeepneyRoute.segmentedPathPoints) / 250)}min
                        </Text>
                      </View>
                      <View style={styles.segmentDetail}>
                        <Ionicons name="swap-horizontal" size={16} color="#FF5722" />
                        <Text style={styles.segmentDetailText}>
                          Transfer: {Math.round(jeepneyRoute.transferDistance)}m
                          {" • "}~{Math.round(jeepneyRoute.transferDistance / 80)}min
                        </Text>
                      </View>
                      <View style={styles.segmentDetail}>
                        <Ionicons name="bus-outline" size={16} color="#4CAF50" />
                        <Text style={styles.segmentDetailText}>
                          Second route: ~{Math.round(calculatePolylineDistance(jeepneyRoute.secondRouteSegment) / 1000).toFixed(1)}km
                          {" • "}~{Math.round(calculatePolylineDistance(jeepneyRoute.secondRouteSegment) / 250)}min
                        </Text>
                      </View>
                    </View>
                    
                    <View style={styles.transferNote}>
                      <Ionicons name="information-circle" size={14} color="#FF5722" />
                      <Text style={styles.transferNoteText}>
                        These routes connect directly. Look for transfer point markers.
                      </Text>
                    </View>
                    
                    <View style={styles.fastestRouteContainer}>
                      <View style={styles.fastestRouteBadge}>
                        <Ionicons name="flash" size={14} color="#fff" />
                        <Text style={styles.fastestRouteText}>Fastest Route</Text>
                      </View>
                      <Text style={styles.fastestRouteDescription}>
                        This route was selected as the fastest option to your destination, optimized for total travel time including transfers.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
      {renderJeepneyRoutesModal()}
      <TouchableOpacity
        style={styles.showRoutesButton}
        onPress={() => setShowJeepneyRoutesModal(true)}
      >
        <Ionicons name="bus" size={20} color="white" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  mapContainer: {
    height: '45%',
    width: '100%',
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  contentContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  searchBarContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  locationFields: {
    backgroundColor: "#f8f9fa",
    borderRadius: 16,
    padding: 12,
  },
  locationField: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  locationText: {
    marginLeft: 10,
    fontSize: 15,
    color: "#333",
    flex: 1,
  },
  locationInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
    color: "#333",
    paddingRight: 8,
  },
  inputActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  loading: {
    marginTop: 10,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 90,
    left: 12,
    right: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 1000,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f3f5",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  routeInfoSection: {
    margin: 8,
  },
  infoContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  infoItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  infoLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  transportSection: {
    margin: 8,
  },
  modeButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  activeModeButton: {
    backgroundColor: "#007bff",
  },
  modeButtonText: {
    color: "#333",
    fontWeight: "600",
    marginLeft: 8,
    fontSize: 16,
  },
  activeModeButtonText: {
    color: "#fff",
  },
  getDirectionsButton: {
    backgroundColor: "#007bff",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  getDirectionsButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
  userMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 123, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userMarkerInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userMarkerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  roadMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  walkLabel: {
    width: 90,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  walkLabelText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  routeLabel: {
    backgroundColor: 'rgba(255, 193, 7, 0.9)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#fff',
  },
  routeLabelText: {
    color: '#333',
    fontWeight: 'bold',
    fontSize: 12,
  },
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
  directionsSection: {
    margin: 8,
  },
  directionsPanel: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  directionStep: {
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  directionStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
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
    fontSize: 14,
    color: '#333',
    marginBottom: 2,
  },
  directionMetrics: {
    fontSize: 12,
    color: '#666',
  },
  viewMoreButton: {
    marginTop: 8,
    padding: 8,
    alignItems: 'center',
  },
  viewMoreText: {
    color: '#007bff',
    fontWeight: '600',
  },
  trafficLight: {
    color: '#4CAF50', // Green
    fontWeight: '600',
  },
  trafficModerate: {
    color: '#FFC107', // Yellow
    fontWeight: '600',
  },
  trafficHeavy: {
    color: '#F44336', // Red
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    padding: 8,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    padding: 5,
  },
  routesList: {
    padding: 15,
  },
  routeCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  routeCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  routeIconContainer: {
    padding: 10,
    borderRadius: 10,
  },
  routeInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  routeDetails: {
    flexDirection: 'row',
    gap: 12,
  },
  routeDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  routeDetailText: {
    fontSize: 13,
    color: '#666',
  },
  modalBody: {
    padding: 16,
  },
  infoCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
  },
  modalText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
    lineHeight: 20,
  },
  modalSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
  },
  noteIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalNote: {
    flex: 1,
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  jeepneyAccessMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFC107',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  jeepneyMarkerIcon: {
    color: '#fff', 
    fontWeight: '600',
  },
  jeepneyRouteInfo: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  jeepneyRouteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  jeepneyRouteName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  jeepneyRouteDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  jeepneyRouteDetailText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  jeepneyRouteTransfer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  jeepneyRouteTransferTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginLeft: 8,
  },
  transferNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FFF5F2',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF5722',
  },
  transferNoteText: {
    flex: 1,
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
  },
  commuteBarolodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  commuteBarolodIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  commuteBarolodText: {
    flex: 1,
    fontSize: 14,
    color: '#007bff',
    fontWeight: '600',
  },
  // Scraping modal styles
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
    fontSize: 16,
  },
  visitWebsiteButton: {
    flexDirection: 'row',
    backgroundColor: '#007bff',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitWebsiteButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    marginRight: 8,
  },
  transferMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF5722',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  transferCallout: {
    padding: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  transferCalloutTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  transferCalloutText: {
    fontSize: 14,
    color: '#666',
  },
  transferCalloutDistance: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  directionBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  directionBadge: {
    backgroundColor: '#FFC107',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
  },
  directionBadgeText: {
    color: '#333',
    fontSize: 12,
    fontWeight: '600',
  },
  transferDirectionBadge: {
    backgroundColor: '#FF5722',
  },
  destinationMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  destinationMarkerInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentDetails: {
    marginTop: 8,
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    padding: 8,
  },
  segmentDetail: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    paddingVertical: 4,
  },
  segmentDetailText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#333",
  },
  fastestRouteContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#F0F8FF',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007bff',
  },
  fastestRouteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007bff',
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  fastestRouteText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
    marginLeft: 4,
  },
  fastestRouteDescription: {
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
  showRoutesButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#40B59F',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    zIndex: 1000,
  },
});