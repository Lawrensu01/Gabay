"use client"

import { useState, useEffect, useRef } from "react"
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
} from "react-native"
import MapView, { Marker, Polyline } from "react-native-maps"
import * as Location from "expo-location"
import axios from "axios"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation, useRoute } from "@react-navigation/native"
import { useAuth } from "../../context/authContext"
import { JEEPNEY_ROUTES_DETAILED } from "./jeepney_routes"

const API_KEY = "AlzaSytyjooqu9_vxaqo-Azx8GTJ7ezSgjBqfvJ"

export default function Navigation() {
  const navigationRoute = useRoute()
  const navigation = useNavigation()
  const { user } = useAuth()

  // Core state
  const [query, setQuery] = useState("")
  const [places, setPlaces] = useState([])
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fromLocation, setFromLocation] = useState("Your Location")
  const [toLocation, setToLocation] = useState("")

  // Route state
  const [routePath, setRoutePath] = useState([])
  const [directions, setDirections] = useState([])
  const [distance, setDistance] = useState(null)
  const [eta, setEta] = useState({})
  const [travelMode, setTravelMode] = useState("driving")
  const [fetchingRoute, setFetchingRoute] = useState(false)

  // Walking route options
  const [fastestWalkingRoute, setFastestWalkingRoute] = useState([])
  const [safestWalkingRoute, setSafestWalkingRoute] = useState([])
  const [showSafestRoute, setShowSafestRoute] = useState(false)

  // Jeepney specific state
  const [jeepneyRoute, setJeepneyRoute] = useState(null)
  const [jeepneyRecommendations, setJeepneyRecommendations] = useState([])
  const [showJeepneyRoutesModal, setShowJeepneyRoutesModal] = useState(false)
  const [alternativeJeepneyRoutes, setAlternativeJeepneyRoutes] = useState([])

  const mapRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  // Initialize location
  useEffect(() => {
    const initializeLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== "granted") {
          console.warn("Permission to access location was denied")
          return
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        })

        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        })
      } catch (error) {
        console.error("Error initializing location:", error)
      }
    }

    initializeLocation()
  }, [])

  // Handle navigation params
  useEffect(() => {
    const params = navigationRoute.params
    if (params?.selectedDestination) {
      try {
        const destination = JSON.parse(params.selectedDestination)
        if (destination) {
          setQuery(destination.name)
          if (destination.placeId) {
            fetchPlaceDetails(destination.placeId)
          } else if (destination.coordinates) {
            setSelectedLocation({
              latitude: destination.coordinates.latitude,
              longitude: destination.coordinates.longitude,
            })
            setToLocation(destination.name)
            setQuery(destination.name)
            setPlaces([])

            if (userLocation) {
              fetchDirections()
            }
          }
        }
      } catch (error) {
        console.error("Error parsing destination data:", error)
      }
    }
  }, [navigationRoute.params])

  // Search for places
  const fetchPlaces = async (text) => {
    setQuery(text)
    if (text.length < 3) {
      setPlaces([])
      return
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await axios.get("https://maps.gomaps.pro/maps/api/place/autocomplete/json", {
          params: {
            input: text,
            key: API_KEY,
            components: "country:PH",
            location: "10.6765,122.9509",
            radius: 10000,
            strictbounds: true,
          },
        })
        setPlaces(response.data.predictions || [])
      } catch (error) {
        console.error("Error fetching places:", error)
        setPlaces([])
      } finally {
        setLoading(false)
      }
    }, 500)
  }

  // Fetch place details
  const fetchPlaceDetails = async (placeId) => {
    try {
      setLoading(true)
      const response = await axios.get("https://maps.gomaps.pro/maps/api/place/details/json", {
        params: {
          place_id: placeId,
          key: API_KEY,
          fields: "geometry,name,vicinity",
        },
      })

      if (response.data.result?.geometry) {
        const location = response.data.result.geometry.location
        setSelectedLocation({
          latitude: location.lat,
          longitude: location.lng,
        })
        setToLocation(response.data.result.name)
        setPlaces([])
        setQuery(response.data.result.name)

        if (userLocation) {
          fetchDirections()
        }
      }
    } catch (error) {
      console.error("Error fetching place details:", error)
    } finally {
      setLoading(false)
    }
  }

  // Fetch directions for different modes
  const fetchDirections = async () => {
    if (!userLocation || !selectedLocation) {
      console.warn("User location or destination not set")
      return
    }

    setFetchingRoute(true)

    try {
      const modes = ["driving", "walking"]
      const newEta = {}

      // Fetch regular routes
      for (const mode of modes) {
        try {
          const response = await axios.get("https://maps.gomaps.pro/maps/api/directions/json", {
            params: {
              origin: `${userLocation.latitude},${userLocation.longitude}`,
              destination: `${selectedLocation.latitude},${selectedLocation.longitude}`,
              key: API_KEY,
              mode: mode,
              departure_time: "now",
              alternatives: true,
            },
          })

          if (response.data.routes?.length > 0) {
            const route = response.data.routes[0]
            const leg = route.legs[0]

            newEta[mode] = leg.duration.text
            setDistance(leg.distance.text)

            if (mode === travelMode) {
              const points = route.overview_polyline.points
              const decodedRoute = decodePolyline(points)
              setRoutePath(decodedRoute)
              fitMapToRoute(decodedRoute)
            }

            // For walking, get both fastest and safest routes
            if (mode === "walking") {
              const fastestRoute = decodePolyline(route.overview_polyline.points)
              setFastestWalkingRoute(fastestRoute)

              // Get safest route (avoid highways, prefer pedestrian paths)
              if (response.data.routes.length > 1) {
                const safestRoute = decodePolyline(response.data.routes[1].overview_polyline.points)
                setSafestWalkingRoute(safestRoute)
              } else {
                // Fetch alternative route avoiding highways
                fetchSafestWalkingRoute()
              }
            }

            // Extract directions
            if (response.data.routes[0].legs[0].steps) {
              const steps = response.data.routes[0].legs[0].steps.map((step) => ({
                instruction: step.html_instructions.replace(/<[^>]*>/g, ""),
                distance: step.distance.text,
                duration: step.duration.text,
              }))
              setDirections(steps)
            }
          }
        } catch (error) {
          console.error(`Error fetching ${mode} directions:`, error)
        }
      }

      setEta(newEta)

      // Get jeepney recommendations
      if (userLocation && selectedLocation) {
        getJeepneyRecommendations()
      }
    } catch (error) {
      console.error("Error in fetchDirections:", error)
    } finally {
      setFetchingRoute(false)
    }
  }

  // Fetch safest walking route
  const fetchSafestWalkingRoute = async () => {
    try {
      const response = await axios.get("https://maps.gomaps.pro/maps/api/directions/json", {
        params: {
          origin: `${userLocation.latitude},${userLocation.longitude}`,
          destination: `${selectedLocation.latitude},${selectedLocation.longitude}`,
          key: API_KEY,
          mode: "walking",
          avoid: "highways",
          alternatives: true,
        },
      })

      if (response.data.routes?.length > 0) {
        const safestRoute = decodePolyline(response.data.routes[0].overview_polyline.points)
        setSafestWalkingRoute(safestRoute)
      }
    } catch (error) {
      console.error("Error fetching safest walking route:", error)
    }
  }

  // Get jeepney route recommendations
  const getJeepneyRecommendations = () => {
    if (!userLocation || !selectedLocation) return

    const routesNearUser = findJeepneyRoutesWithinRadius(userLocation, 0.5)
    const routesNearDestination = findJeepneyRoutesWithinRadius(selectedLocation, 0.5)

    // Find direct routes (same jeepney serves both locations)
    const directRoutes = routesNearUser.filter((userRoute) =>
      routesNearDestination.some(
        (destRoute) => destRoute.routeId === userRoute.routeId && destRoute.pathId === userRoute.pathId,
      ),
    )

    // Find transfer routes
    const transferRoutes = []
    if (directRoutes.length === 0) {
      routesNearUser.forEach((userRoute) => {
        routesNearDestination.forEach((destRoute) => {
          if (userRoute.routeId !== destRoute.routeId) {
            const transferPoint = findTransferPoint(userRoute, destRoute)
            if (transferPoint) {
              transferRoutes.push({
                firstRoute: userRoute,
                secondRoute: destRoute,
                transferPoint: transferPoint,
                type: "transfer",
              })
            }
          }
        })
      })
    }

    // Combine and sort recommendations
    const recommendations = [...directRoutes.map((route) => ({ ...route, type: "direct" })), ...transferRoutes].sort(
      (a, b) => a.distance - b.distance,
    )

    setJeepneyRecommendations(recommendations.slice(0, 3)) // Top 3 recommendations

    // Set the best route as primary
    if (recommendations.length > 0) {
      const bestRoute = recommendations[0]
      if (bestRoute.type === "direct") {
        setJeepneyRoute(createDirectJeepneyRoute(bestRoute))
      } else {
        setJeepneyRoute(createTransferJeepneyRoute(bestRoute))
      }
    }
  }

  // Create direct jeepney route
  const createDirectJeepneyRoute = (routeInfo) => {
    const routeDetails = JEEPNEY_ROUTES_DETAILED[routeInfo.routeId]
    if (!routeDetails) return null

    const pathDetails = routeDetails.paths.find((p) => p.pathId === routeInfo.pathId)
    if (!pathDetails) return null

    const routePath = pathDetails.via.map((point) => ({
      latitude: point.lat,
      longitude: point.lng,
    }))

    const userAccessPoint = {
      latitude: routeInfo.nearestPoint.lat,
      longitude: routeInfo.nearestPoint.lng,
    }

    // Find destination access point
    const destRouteInfo = findJeepneyRoutesWithinRadius(selectedLocation, 0.5).find(
      (r) => r.routeId === routeInfo.routeId && r.pathId === routeInfo.pathId,
    )

    const destinationAccessPoint = destRouteInfo
      ? {
          latitude: destRouteInfo.nearestPoint.lat,
          longitude: destRouteInfo.nearestPoint.lng,
        }
      : selectedLocation

    return {
      ...routeDetails,
      type: "direct",
      userAccessPoint,
      destinationAccessPoint,
      walkingDistance: routeInfo.distance,
      routePath,
      pathId: routeInfo.pathId,
      from: pathDetails.from,
      to: pathDetails.to,
    }
  }

  // Create transfer jeepney route
  const createTransferJeepneyRoute = (routeInfo) => {
    const firstRouteDetails = JEEPNEY_ROUTES_DETAILED[routeInfo.firstRoute.routeId]
    const secondRouteDetails = JEEPNEY_ROUTES_DETAILED[routeInfo.secondRoute.routeId]

    if (!firstRouteDetails || !secondRouteDetails) return null

    return {
      ...firstRouteDetails,
      type: "transfer",
      firstRoute: firstRouteDetails,
      secondRoute: secondRouteDetails,
      transferPoint: routeInfo.transferPoint,
      userAccessPoint: {
        latitude: routeInfo.firstRoute.nearestPoint.lat,
        longitude: routeInfo.firstRoute.nearestPoint.lng,
      },
      destinationAccessPoint: {
        latitude: routeInfo.secondRoute.nearestPoint.lat,
        longitude: routeInfo.secondRoute.nearestPoint.lng,
      },
    }
  }

  // Find jeepney routes within radius
  const findJeepneyRoutesWithinRadius = (location, radiusKm) => {
    if (!location) return []

    const routesWithinRadius = []

    Object.entries(JEEPNEY_ROUTES_DETAILED).forEach(([routeId, routeDetails]) => {
      routeDetails.paths.forEach((path) => {
        let closestPoint = null
        let minDistance = Number.POSITIVE_INFINITY

        path.via.forEach((point) => {
          const distance = calculateDistance(location.latitude, location.longitude, point.lat, point.lng)

          if (distance < minDistance) {
            minDistance = distance
            closestPoint = point
          }
        })

        if (minDistance <= radiusKm && closestPoint) {
          routesWithinRadius.push({
            route: routeDetails,
            distance: minDistance,
            nearestPoint: closestPoint,
            routeId: routeId,
            pathId: path.pathId,
            from: path.from,
            to: path.to,
          })
        }
      })
    })

    return routesWithinRadius.sort((a, b) => a.distance - b.distance)
  }

  // Find transfer point between routes
  const findTransferPoint = (route1, route2) => {
    // Simplified transfer point logic
    // In a real app, this would check for actual connection points
    const midpoint = {
      latitude: (route1.nearestPoint.lat + route2.nearestPoint.lat) / 2,
      longitude: (route1.nearestPoint.lng + route2.nearestPoint.lng) / 2,
    }

    const distance = calculateDistance(
      route1.nearestPoint.lat,
      route1.nearestPoint.lng,
      route2.nearestPoint.lat,
      route2.nearestPoint.lng,
    )

    // Only consider as transfer if routes are within 500m of each other
    return distance <= 0.5 ? midpoint : null
  }

  // Handle transport mode change
  const handleModeChange = (mode) => {
    setTravelMode(mode)

    if (mode === "book-ride") {
      handleBookRide()
      return
    }

    if (mode === "jeepney" && jeepneyRoute) {
      // Show jeepney route
      if (jeepneyRoute.routePath) {
        setRoutePath(jeepneyRoute.routePath)
        fitMapToRoute(jeepneyRoute.routePath)
      }

      // Set jeepney ETA
      const etaMinutes = Math.round((jeepneyRoute.walkingDistance || 0.5) * 20)
      const etaText =
        etaMinutes < 60 ? `${etaMinutes} mins` : `${Math.floor(etaMinutes / 60)} hr ${etaMinutes % 60} mins`
      setEta((prev) => ({ ...prev, jeepney: etaText }))
    } else if (mode === "walking") {
      // Show appropriate walking route
      const walkingRoute = showSafestRoute ? safestWalkingRoute : fastestWalkingRoute
      if (walkingRoute.length > 0) {
        setRoutePath(walkingRoute)
        fitMapToRoute(walkingRoute)
      }
    } else if (userLocation && selectedLocation) {
      fetchDirections()
    }
  }

  // Toggle between fastest and safest walking routes
  const toggleWalkingRoute = () => {
    setShowSafestRoute(!showSafestRoute)
    const newRoute = !showSafestRoute ? safestWalkingRoute : fastestWalkingRoute
    if (newRoute.length > 0 && travelMode === "walking") {
      setRoutePath(newRoute)
      fitMapToRoute(newRoute)
    }
  }

  // Handle book ride
  const handleBookRide = () => {
    if (!selectedLocation) {
      Alert.alert("Select Destination", "Please select a destination first")
      return
    }

    const grabUrl = `grab://open?dropoff=${selectedLocation.latitude},${selectedLocation.longitude}&dropoffName=${encodeURIComponent(toLocation)}`

    Linking.canOpenURL(grabUrl)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(grabUrl)
        } else {
          const storeUrl = Platform.select({
            ios: "https://apps.apple.com/app/grab-app/id647268330",
            android: "market://details?id=com.grabtaxi.passenger",
          })
          return Linking.openURL(storeUrl)
        }
      })
      .catch((err) => {
        console.error("Error opening Grab app:", err)
        Alert.alert("Error", "Unable to open Grab app. Please make sure it's installed.")
      })
  }

  // Calculate distance between two points
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Decode polyline
  const decodePolyline = (encoded) => {
    const points = []
    let index = 0,
      lat = 0,
      lng = 0

    while (index < encoded.length) {
      let b,
        shift = 0,
        result = 0
      do {
        b = encoded.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const dlat = result & 1 ? ~(result >> 1) : result >> 1
      lat += dlat

      shift = 0
      result = 0
      do {
        b = encoded.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const dlng = result & 1 ? ~(result >> 1) : result >> 1
      lng += dlng

      points.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
    }
    return points
  }

  // Fit map to route
  const fitMapToRoute = (routePoints) => {
    if (!mapRef.current || !routePoints?.length) return

    try {
      const coordinates = [...routePoints]

      if (userLocation) coordinates.push(userLocation)
      if (selectedLocation) coordinates.push(selectedLocation)

      if (coordinates.length > 1) {
        mapRef.current.fitToCoordinates(coordinates, {
          edgePadding: { top: 70, right: 70, bottom: 70, left: 70 },
          animated: true,
        })
      }
    } catch (error) {
      console.error("Error fitting map to route:", error)
    }
  }

  // Clear search
  const clearSearch = () => {
    setQuery("")
    setPlaces([])
    setSelectedLocation(null)
    setToLocation("")
    setRoutePath([])
    setDirections([])
    setDistance(null)
    setEta({})
    setJeepneyRoute(null)
    setJeepneyRecommendations([])
    setTravelMode("driving")

    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      })
    }
  }

  // Get route color for jeepney routes
  const getRouteColor = (routeName) => {
    if (routeName.includes("Banago")) return "#2E8B57"
    if (routeName.includes("Northbound")) return "#3CB371"
    if (routeName.includes("Tangub")) return "#20B2AA"
    if (routeName.includes("Airport")) return "#32CD32"
    if (routeName.includes("Mandalagan")) return "#66CDAA"
    if (routeName.includes("Bata")) return "#98FB98"
    return "#2E8B57"
  }

  // Render jeepney routes modal
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
              <View style={[styles.iconContainer, { backgroundColor: "#2E8B57" }]}>
                <Ionicons name="bus" size={28} color="white" />
              </View>
              <Text style={styles.modalTitle}>Jeepney Routes</Text>
            </View>
            <TouchableOpacity onPress={() => setShowJeepneyRoutesModal(false)} style={styles.closeButton}>
              <Ionicons name="close-circle" size={28} color="#2E8B57" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.routesList} showsVerticalScrollIndicator={false}>
            {Object.entries(JEEPNEY_ROUTES_DETAILED).map(([id, route]) => {
              const routeColor = getRouteColor(route.name)
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
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )

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
            <Marker coordinate={selectedLocation} title="Destination">
              <View style={styles.destinationMarker}>
                <View style={styles.destinationMarkerInner}>
                  <Ionicons name="location" size={12} color="#fff" />
                </View>
              </View>
            </Marker>
          )}

          {/* Route polylines */}
          {routePath.length > 0 && (
            <Polyline
              coordinates={routePath}
              strokeWidth={6}
              strokeColor={
                travelMode === "jeepney"
                  ? "#FFC107"
                  : travelMode === "walking" && showSafestRoute
                    ? "#4CAF50"
                    : "#007bff"
              }
              lineCap="round"
              lineJoin="round"
            />
          )}

          {/* Show both walking routes when in walking mode */}
          {travelMode === "walking" && fastestWalkingRoute.length > 0 && safestWalkingRoute.length > 0 && (
            <>
              <Polyline
                coordinates={fastestWalkingRoute}
                strokeWidth={showSafestRoute ? 3 : 6}
                strokeColor={showSafestRoute ? "#999" : "#007bff"}
                lineCap="round"
                lineJoin="round"
                lineDashPattern={showSafestRoute ? [5, 5] : []}
              />
              <Polyline
                coordinates={safestWalkingRoute}
                strokeWidth={showSafestRoute ? 6 : 3}
                strokeColor={showSafestRoute ? "#4CAF50" : "#999"}
                lineCap="round"
                lineJoin="round"
                lineDashPattern={showSafestRoute ? [] : [5, 5]}
              />
            </>
          )}

          {/* Jeepney access points */}
          {travelMode === "jeepney" && jeepneyRoute && (
            <>
              {jeepneyRoute.userAccessPoint && (
                <Marker coordinate={jeepneyRoute.userAccessPoint} title="Jeepney Stop">
                  <View style={styles.jeepneyAccessMarker}>
                    <Ionicons name="bus" size={12} color="#fff" />
                  </View>
                </Marker>
              )}
              {jeepneyRoute.destinationAccessPoint && (
                <Marker coordinate={jeepneyRoute.destinationAccessPoint} title="Destination Stop">
                  <View style={styles.jeepneyAccessMarker}>
                    <Ionicons name="bus" size={12} color="#fff" />
                  </View>
                </Marker>
              )}
            </>
          )}
        </MapView>
      </View>

      {/* Main content */}
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
              {query.length > 0 && (
                <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
                  <Ionicons name="close-circle" size={20} color="#888" />
                </TouchableOpacity>
              )}
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
                <TouchableOpacity style={styles.suggestionItem} onPress={() => fetchPlaceDetails(item.place_id)}>
                  <Text numberOfLines={2}>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Route Info */}
          <View style={styles.routeInfoSection}>
            <View style={styles.infoContainer}>
              <View style={styles.infoItem}>
                <Ionicons name="time-outline" size={20} color="#666" />
                <Text style={styles.infoLabel}>ETA</Text>
                <Text style={styles.infoValue}>{fetchingRoute ? "Calculating..." : eta[travelMode] || "N/A"}</Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="speedometer-outline" size={20} color="#666" />
                <Text style={styles.infoLabel}>Distance</Text>
                <Text style={styles.infoValue}>{fetchingRoute ? "Calculating..." : distance || "N/A"}</Text>
              </View>
              <View style={styles.infoItem}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#666" />
                <Text style={styles.infoLabel}>Route</Text>
                <Text style={styles.infoValue}>
                  {travelMode === "walking" ? (showSafestRoute ? "Safest" : "Fastest") : "Optimal"}
                </Text>
              </View>
            </View>
          </View>

          {/* Transport Mode Buttons */}
          <View style={styles.transportSection}>
            <View style={styles.modeButtonsGrid}>
              {["driving", "walking", "jeepney", "book-ride"].map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.modeButton, travelMode === mode && styles.activeModeButton]}
                  onPress={() => handleModeChange(mode)}
                >
                  <Ionicons
                    name={
                      mode === "driving"
                        ? "car"
                        : mode === "walking"
                          ? "walk"
                          : mode === "book-ride"
                            ? "car-sport"
                            : "bus"
                    }
                    size={20}
                    color={travelMode === mode ? "#fff" : "#007bff"}
                  />
                  <Text style={[styles.modeButtonText, travelMode === mode && styles.activeModeButtonText]}>
                    {mode === "book-ride" ? "Book Ride" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Walking route toggle */}
            {travelMode === "walking" && fastestWalkingRoute.length > 0 && safestWalkingRoute.length > 0 && (
              <TouchableOpacity style={styles.walkingToggleButton} onPress={toggleWalkingRoute}>
                <Ionicons name={showSafestRoute ? "shield-checkmark" : "flash"} size={16} color="#007bff" />
                <Text style={styles.walkingToggleText}>Switch to {showSafestRoute ? "Fastest" : "Safest"} Route</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.getDirectionsButton}
              onPress={fetchDirections}
              disabled={fetchingRoute || !userLocation || !selectedLocation}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.getDirectionsButtonText}>{fetchingRoute ? "Calculating..." : "Get Directions"}</Text>
            </TouchableOpacity>
          </View>

          {/* Jeepney Recommendations */}
          {travelMode === "jeepney" && jeepneyRecommendations.length > 0 && (
            <View style={styles.recommendationsSection}>
              <Text style={styles.sectionTitle}>Jeepney Recommendations</Text>
              {jeepneyRecommendations.map((recommendation, index) => (
                <View key={index} style={styles.recommendationCard}>
                  <View style={styles.recommendationHeader}>
                    <Ionicons name="bus" size={20} color="#FFC107" />
                    <Text style={styles.recommendationTitle}>
                      {JEEPNEY_ROUTES_DETAILED[recommendation.routeId]?.name || "Unknown Route"}
                    </Text>
                    <View
                      style={[
                        styles.recommendationBadge,
                        { backgroundColor: recommendation.type === "direct" ? "#4CAF50" : "#FF9800" },
                      ]}
                    >
                      <Text style={styles.recommendationBadgeText}>
                        {recommendation.type === "direct" ? "Direct" : "Transfer"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.recommendationDistance}>
                    Walk {Math.round(recommendation.distance * 1000)}m to nearest stop
                  </Text>
                  {recommendation.type === "transfer" && (
                    <Text style={styles.recommendationTransfer}>
                      Transfer to {JEEPNEY_ROUTES_DETAILED[recommendation.secondRoute?.routeId]?.name}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Directions */}
          {directions.length > 0 && (
            <View style={styles.directionsSection}>
              <Text style={styles.sectionTitle}>Directions</Text>
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
                        {step.distance} • {step.duration}
                      </Text>
                    </View>
                  </View>
                ))}

                {directions.length > 3 && (
                  <TouchableOpacity style={styles.viewMoreButton}>
                    <Text style={styles.viewMoreText}>View All Steps</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Floating jeepney routes button */}
      <TouchableOpacity style={styles.showRoutesButton} onPress={() => setShowJeepneyRoutesModal(true)}>
        <Ionicons name="bus" size={20} color="white" />
      </TouchableOpacity>

      {renderJeepneyRoutesModal()}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  mapContainer: {
    height: "45%",
    width: "100%",
    position: "relative",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  contentContainer: {
    flex: 1,
    backgroundColor: "#fff",
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
    backgroundColor: "#fff",
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
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
  loading: {
    marginTop: 10,
  },
  suggestionsContainer: {
    position: "absolute",
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
    minWidth: "45%",
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
  walkingToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8f9fa",
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#007bff",
  },
  walkingToggleText: {
    color: "#007bff",
    fontWeight: "600",
    marginLeft: 4,
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
  recommendationsSection: {
    margin: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  recommendationCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  recommendationHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  recommendationTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginLeft: 8,
    flex: 1,
  },
  recommendationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recommendationBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  recommendationDistance: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  recommendationTransfer: {
    fontSize: 14,
    color: "#FF9800",
    fontWeight: "500",
  },
  directionsSection: {
    margin: 8,
  },
  directionsPanel: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  directionStep: {
    flexDirection: "row",
    marginBottom: 10,
    alignItems: "flex-start",
  },
  directionStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007bff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  stepNumberText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  directionStepContent: {
    flex: 1,
  },
  directionText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 2,
  },
  directionMetrics: {
    fontSize: 12,
    color: "#666",
  },
  viewMoreButton: {
    marginTop: 8,
    padding: 8,
    alignItems: "center",
  },
  viewMoreText: {
    color: "#007bff",
    fontWeight: "600",
  },
  userMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 123, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  userMarkerInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#007bff",
    justifyContent: "center",
    alignItems: "center",
  },
  userMarkerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  destinationMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 59, 48, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  destinationMarkerInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FF3B30",
    justifyContent: "center",
    alignItems: "center",
  },
  jeepneyAccessMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFC107",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  showRoutesButton: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "#40B59F",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    zIndex: 1000,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 20,
    width: "90%",
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  modalTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconContainer: {
    padding: 8,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  closeButton: {
    padding: 5,
  },
  routesList: {
    padding: 15,
  },
  routeCard: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#eee",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  routeCardContent: {
    flexDirection: "row",
    alignItems: "center",
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
    color: "#333",
    fontWeight: "600",
  },
})
