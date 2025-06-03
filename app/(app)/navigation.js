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
  Modal,
  Linking,
  Platform,
  Alert,
} from "react-native"
import MapView, { Marker, Polyline } from "react-native-maps"
import * as Location from "expo-location"
import axios from "axios"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation, useRoute } from "@react-navigation/native"
import { useAuth } from "../../context/authContext"
import { JEEPNEY_ROUTES_DETAILED } from "./jeepney_routes"

const API_KEY = "AlzaSyuXryjNYbGxqXXsY8cgTEnntUZn7XnnLA"

// Smart jeepney route recommendation system
class SmartJeepneyOptimizer {
  constructor(routesData) {
    this.routes = routesData
    this.routeGraph = this.buildRouteGraph()
  }

  buildRouteGraph() {
    const graph = new Map()

    Object.entries(this.routes).forEach(([routeId, routeData]) => {
      routeData.paths.forEach((path) => {
        const pathKey = `${routeId}_${path.pathId}`
        graph.set(pathKey, {
          routeId,
          routeName: routeData.name,
          path,
          coordinates: path.via,
          isInbound: path.pathId.includes("inbound"),
          isOutbound: path.pathId.includes("outbound"),
          from: path.from,
          to: path.to,
        })
      })
    })

    return graph
  }

  findOptimalRoutes(userLocation, destination, maxWalkingDistance = 0.5) {
    console.log("🚌 Starting smart jeepney route analysis...")

    try {
      // Step 1: Find all routes near user location and destination
      const nearbyStartRoutes = this.findNearbyRoutes(userLocation, maxWalkingDistance)
      const nearbyEndRoutes = this.findNearbyRoutes(destination, maxWalkingDistance)

      console.log(
        `📍 Found ${nearbyStartRoutes.length} routes near start, ${nearbyEndRoutes.length} routes near destination`,
      )

      // Step 2: Find single jeepney solutions (same route, any direction)
      const singleJeepneyRoutes = this.findBestDirectionRoutes(nearbyStartRoutes, nearbyEndRoutes)

      if (singleJeepneyRoutes && singleJeepneyRoutes.length > 0) {
        console.log(`✅ Found ${singleJeepneyRoutes.length} single jeepney solutions`)
        return singleJeepneyRoutes.slice(0, 1) // Return only the best single route
      }

      // Step 3: Find transfer routes between different jeepney lines (last resort)
      const transferRoutes = this.findTransferRoutes(nearbyStartRoutes, nearbyEndRoutes)

      console.log(`🔄 Found ${transferRoutes.length} transfer solutions`)
      return transferRoutes.length > 0 ? transferRoutes.slice(0, 2) : [] // Return top 2 transfer options
    } catch (error) {
      console.error("Error in findOptimalRoutes:", error)
      return []
    }
  }

  findBestDirectionRoutes(startRoutes, endRoutes) {
    if (!startRoutes || !endRoutes || startRoutes.length === 0 || endRoutes.length === 0) {
      return []
    }

    const directRoutes = []

    // Group routes by route ID to combine inbound/outbound
    const routeGroups = new Map()

    // Collect all route access points
    const allRoutes = [...startRoutes, ...endRoutes]
    allRoutes.forEach((route) => {
      if (!routeGroups.has(route.routeId)) {
        routeGroups.set(route.routeId, {
          routeId: route.routeId,
          routeName: route.routeName,
          inbound: null,
          outbound: null,
          startPoints: [],
          endPoints: [],
        })
      }

      const group = routeGroups.get(route.routeId)

      if (route.isInbound) {
        group.inbound = route
      } else if (route.isOutbound) {
        group.outbound = route
      }

      // Track which routes can serve start/end points
      if (startRoutes.includes(route)) {
        group.startPoints.push(route)
      }
      if (endRoutes.includes(route)) {
        group.endPoints.push(route)
      }
    })

    // Analyze each route group for the best direction
    routeGroups.forEach((group, routeId) => {
      if (group.startPoints.length > 0 && group.endPoints.length > 0) {
        const bestRoute = this.findBestDirectionForRoute(group)
        if (bestRoute) {
          directRoutes.push(bestRoute)
        }
      }
    })

    return directRoutes.sort((a, b) => a.score - b.score)
  }

  findBestDirectionForRoute(routeGroup) {
    const solutions = []

    // Check all combinations of start and end points for this route
    routeGroup.startPoints.forEach((startRoute) => {
      routeGroup.endPoints.forEach((endRoute) => {
        // Same direction - check if valid sequence
        if (startRoute.pathKey === endRoute.pathKey && this.isValidSequence(startRoute, endRoute)) {
          const solution = this.createDirectSolution(startRoute, endRoute, "same-direction")
          solutions.push(solution)
        }

        // Different directions - combine the route intelligently
        else if (startRoute.pathKey !== endRoute.pathKey) {
          const combinedSolution = this.createCombinedDirectionSolution(startRoute, endRoute, routeGroup)
          if (combinedSolution) {
            solutions.push(combinedSolution)
          }
        }
      })
    })

    // Return the best solution for this route, or null if no solutions found
    if (solutions.length === 0) {
      return null
    }

    return solutions.sort((a, b) => a.score - b.score)[0]
  }

  createCombinedDirectionSolution(startRoute, endRoute, routeGroup) {
    // Get the complete route by combining inbound and outbound
    const { inbound, outbound } = routeGroup

    if (!inbound || !outbound || !inbound.coordinates || !outbound.coordinates) {
      return null
    }

    // Create a combined route path
    let combinedPath = []
    let boardingPoint = null
    let alightingPoint = null
    let direction = ""
    let estimatedTime = 0

    // Determine the best path to take
    if (startRoute.isOutbound && endRoute.isInbound) {
      // Start outbound, end inbound - take outbound to terminus, then inbound
      const outboundFromStart = outbound.coordinates.slice(startRoute.pointIndex)
      const inboundToEnd = inbound.coordinates.slice(0, endRoute.pointIndex + 1)

      combinedPath = [...outboundFromStart, ...inboundToEnd]
      boardingPoint = startRoute.accessPoint
      alightingPoint = endRoute.accessPoint
      direction = "outbound → inbound"
      estimatedTime = this.estimateCombinedDirectionTime(outboundFromStart.length, inboundToEnd.length)
    } else if (startRoute.isInbound && endRoute.isOutbound) {
      // Start inbound, end outbound - take inbound to terminus, then outbound
      const inboundFromStart = inbound.coordinates.slice(startRoute.pointIndex)
      const outboundToEnd = outbound.coordinates.slice(0, endRoute.pointIndex + 1)

      combinedPath = [...inboundFromStart, ...outboundToEnd]
      boardingPoint = startRoute.accessPoint
      alightingPoint = endRoute.accessPoint
      direction = "inbound → outbound"
      estimatedTime = this.estimateCombinedDirectionTime(inboundFromStart.length, outboundToEnd.length)
    }

    if (combinedPath.length === 0) {
      return null
    }

    const routeDistance = this.calculatePathDistance(combinedPath)
    const walkingDistance = startRoute.walkingDistance + endRoute.walkingDistance

    return {
      type: "combined-direction",
      routeId: routeGroup.routeId,
      routeName: routeGroup.routeName,
      direction,
      boardingPoint,
      alightingPoint,
      walkingDistance,
      routeDistance,
      estimatedTime,
      routePath: combinedPath.map((coord) => ({
        latitude: coord.lat,
        longitude: coord.lng,
      })),
      instructions: this.generateCombinedDirectionInstructions(startRoute, endRoute, direction),
      score: this.calculateRouteScore(walkingDistance, routeDistance, 0.5), // Small penalty for direction change
    }
  }

  createDirectSolution(startRoute, endRoute, type) {
    const routeDistance = this.calculateRouteSegmentDistance(startRoute, endRoute)
    const walkingDistance = startRoute.walkingDistance + endRoute.walkingDistance
    const direction = startRoute.isInbound ? "inbound" : "outbound"

    return {
      type: "direct",
      routeId: startRoute.routeId,
      routeName: startRoute.routeName,
      direction,
      boardingPoint: startRoute.accessPoint,
      alightingPoint: endRoute.accessPoint,
      walkingDistance,
      routeDistance,
      estimatedTime: this.estimateDirectRouteTime(startRoute, endRoute, routeDistance),
      routePath: this.extractDirectRoutePath(startRoute, endRoute),
      instructions: this.generateDirectRouteInstructions(startRoute, endRoute),
      score: this.calculateRouteScore(walkingDistance, routeDistance, 0),
    }
  }

  estimateCombinedDirectionTime(firstSegmentLength, secondSegmentLength) {
    // Estimate time for combined direction (includes waiting at terminus)
    const jeepneyTime = (firstSegmentLength + secondSegmentLength) * 0.5 // 0.5 min per stop
    const waitTime = 5 // Wait time at terminus
    return Math.round(jeepneyTime + waitTime)
  }

  calculatePathDistance(path) {
    let totalDistance = 0
    for (let i = 0; i < path.length - 1; i++) {
      totalDistance += this.calculateDistance(path[i].lat, path[i].lng, path[i + 1].lat, path[i + 1].lng)
    }
    return totalDistance
  }

  generateCombinedDirectionInstructions(startRoute, endRoute, direction) {
    return [
      `Walk ${Math.round(startRoute.walkingDistance * 1000)}m to ${startRoute.routeName} jeepney stop`,
      `Board ${startRoute.routeName} jeepney (${direction.split(" → ")[0]} direction)`,
      `Stay on the jeepney as it completes the route and changes direction`,
      `Continue riding in the ${direction.split(" → ")[1]} direction to your destination`,
      `Alight at your destination stop`,
      `Walk ${Math.round(endRoute.walkingDistance * 1000)}m to your final destination`,
    ]
  }

  findTransferRoutes(startRoutes, endRoutes) {
    if (!startRoutes || !endRoutes || startRoutes.length === 0 || endRoutes.length === 0) {
      return []
    }

    const transferRoutes = []

    startRoutes.forEach((startRoute) => {
      endRoutes.forEach((endRoute) => {
        // Only create transfers between DIFFERENT jeepney routes
        if (startRoute.routeId !== endRoute.routeId) {
          const transferPoints = this.findTransferPointsBetweenRoutes(startRoute, endRoute)

          if (transferPoints && transferPoints.length > 0) {
            const bestTransfer = transferPoints[0]

            transferRoutes.push({
              type: "transfer",
              firstRoute: startRoute,
              secondRoute: endRoute,
              transferPoint: bestTransfer,
              boardingPoint: startRoute.accessPoint,
              transferLocation: bestTransfer.location,
              alightingPoint: endRoute.accessPoint,
              walkingDistance: startRoute.walkingDistance + endRoute.walkingDistance + bestTransfer.walkingDistance,
              estimatedTime: this.estimateTransferRouteTime(
                this.calculateRouteSegmentDistance(startRoute, { pointIndex: bestTransfer.route1Index }),
                this.calculateRouteSegmentDistance({ pointIndex: bestTransfer.route2Index }, endRoute),
                bestTransfer.walkingDistance,
              ),
              routePath: {
                firstPath: this.extractRouteSegment(
                  startRoute.coordinates,
                  startRoute.pointIndex,
                  bestTransfer.route1Index,
                ),
                secondPath: this.extractRouteSegment(
                  endRoute.coordinates,
                  bestTransfer.route2Index,
                  endRoute.pointIndex,
                ),
                transferPoint: bestTransfer.location,
              },
              instructions: this.generateTransferInstructions(startRoute, endRoute, bestTransfer),
              score: this.calculateRouteScore(
                startRoute.walkingDistance + endRoute.walkingDistance + bestTransfer.walkingDistance,
                0,
                2, // Heavy penalty for actual transfers between different routes
              ),
            })
          }
        }
      })
    })

    return transferRoutes.sort((a, b) => a.score - b.score)
  }

  findNearbyRoutes(location, maxDistance) {
    if (!location) return []

    const nearby = []

    this.routeGraph.forEach((routeInfo, pathKey) => {
      if (!routeInfo.coordinates || routeInfo.coordinates.length === 0) return

      const nearestPoint = this.findNearestPointOnRoute(routeInfo, location)

      if (nearestPoint && nearestPoint.distance <= maxDistance) {
        nearby.push({
          ...routeInfo,
          accessPoint: routeInfo.coordinates[nearestPoint.pointIndex],
          walkingDistance: nearestPoint.distance,
          pointIndex: nearestPoint.pointIndex,
          pathKey,
        })
      }
    })

    return nearby.sort((a, b) => a.walkingDistance - b.walkingDistance)
  }

  findNearestPointOnRoute(route, location) {
    if (!route.coordinates || !location) return null

    let minDistance = Number.POSITIVE_INFINITY
    let nearestPointIndex = -1

    route.coordinates.forEach((coord, index) => {
      if (!coord || !coord.lat || !coord.lng) return

      const distance = this.calculateDistance(location.latitude, location.longitude, coord.lat, coord.lng)

      if (distance < minDistance) {
        minDistance = distance
        nearestPointIndex = index
      }
    })

    if (nearestPointIndex === -1) return null

    return {
      distance: minDistance,
      pointIndex: nearestPointIndex,
      point: route.coordinates[nearestPointIndex],
    }
  }

  findTransferPointsBetweenRoutes(route1, route2) {
    if (!route1 || !route2 || !route1.coordinates || !route2.coordinates) return []

    const transferPoints = []
    const maxTransferDistance = 0.3

    // Get relevant segments for transfer
    const route1Segment = route1.coordinates.slice(route1.pointIndex)
    const route2Segment = route2.coordinates.slice(0, route2.pointIndex + 1)

    route1Segment.forEach((point1, idx1) => {
      route2Segment.forEach((point2, idx2) => {
        if (!point1 || !point2 || !point1.lat || !point1.lng || !point2.lat || !point2.lng) return

        const distance = this.calculateDistance(point1.lat, point1.lng, point2.lat, point2.lng)

        if (distance <= maxTransferDistance) {
          transferPoints.push({
            location: {
              latitude: (point1.lat + point2.lat) / 2,
              longitude: (point1.lng + point2.lng) / 2,
            },
            route1Index: route1.pointIndex + idx1,
            route2Index: idx2,
            walkingDistance: distance,
          })
        }
      })
    })

    return transferPoints.sort((a, b) => a.walkingDistance - b.walkingDistance)
  }

  isValidSequence(startRoute, endRoute) {
    // Ensure destination comes after origin in the route sequence
    return endRoute.pointIndex > startRoute.pointIndex
  }

  extractDirectRoutePath(startRoute, endRoute) {
    return this.extractRouteSegment(startRoute.coordinates, startRoute.pointIndex, endRoute.pointIndex)
  }

  extractRouteSegment(coordinates, startIndex, endIndex) {
    if (!coordinates || !Array.isArray(coordinates)) return []

    return coordinates.slice(startIndex, endIndex + 1).map((coord) => ({
      latitude: coord.lat,
      longitude: coord.lng,
    }))
  }

  calculateRouteSegmentDistance(startRoute, endRoute) {
    if (!startRoute || !endRoute || !startRoute.coordinates) return 0

    let totalDistance = 0
    const coordinates = startRoute.coordinates

    for (let i = startRoute.pointIndex; i < endRoute.pointIndex; i++) {
      if (i + 1 < coordinates.length) {
        totalDistance += this.calculateDistance(
          coordinates[i].lat,
          coordinates[i].lng,
          coordinates[i + 1].lat,
          coordinates[i + 1].lng,
        )
      }
    }

    return totalDistance
  }

  estimateDirectRouteTime(startRoute, endRoute, routeDistance) {
    const walkingTime = (startRoute.walkingDistance + endRoute.walkingDistance) * 12 // 12 min per km
    const jeepneyTime = routeDistance * 4 // 4 min per km including stops
    return Math.round(walkingTime + jeepneyTime)
  }

  estimateTransferRouteTime(firstSegmentDistance, secondSegmentDistance, transferWalkDistance) {
    const walkingTime = transferWalkDistance * 12
    const jeepneyTime = (firstSegmentDistance + secondSegmentDistance) * 4
    const waitTime = 8 // Average wait time for transfer
    return Math.round(walkingTime + jeepneyTime + waitTime)
  }

  calculateRouteScore(walkingDistance, routeDistance, transferPenalty) {
    let score = walkingDistance * 100 // Penalize walking distance heavily
    score += routeDistance * 10 // Add route distance
    score += transferPenalty * 30 // Heavy penalty for transfers
    return score
  }

  generateDirectRouteInstructions(startRoute, endRoute) {
    const direction = startRoute.isInbound ? "inbound" : "outbound"
    return [
      `Walk ${Math.round(startRoute.walkingDistance * 1000)}m to ${startRoute.routeName} jeepney stop`,
      `Board ${startRoute.routeName} jeepney (${direction} direction)`,
      `Ride for approximately ${this.estimateDirectRouteTime(startRoute, endRoute, this.calculateRouteSegmentDistance(startRoute, endRoute))} minutes`,
      `Alight at your destination stop`,
      `Walk ${Math.round(endRoute.walkingDistance * 1000)}m to your final destination`,
    ]
  }

  generateTransferInstructions(firstRoute, secondRoute, transferPoint) {
    return [
      `Walk ${Math.round(firstRoute.walkingDistance * 1000)}m to ${firstRoute.routeName} jeepney stop`,
      `Board ${firstRoute.routeName} jeepney (${firstRoute.isInbound ? "inbound" : "outbound"} direction)`,
      `Ride to transfer point`,
      `Walk ${Math.round(transferPoint.walkingDistance * 1000)}m to ${secondRoute.routeName} jeepney stop`,
      `Board ${secondRoute.routeName} jeepney (${secondRoute.isInbound ? "inbound" : "outbound"} direction)`,
      `Ride to your destination`,
      `Walk ${Math.round(secondRoute.walkingDistance * 1000)}m to your final destination`,
    ]
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    if (typeof lat1 !== "number" || typeof lon1 !== "number" || typeof lat2 !== "number" || typeof lon2 !== "number") {
      return 0
    }

    const R = 6371 // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }
}

export default function SmartJeepneyNavigation() {
  const navigationRoute = useRoute()
  const navigation = useNavigation()
  const { user } = useAuth()

  // Initialize the smart route optimizer
  const routeOptimizer = useRef(new SmartJeepneyOptimizer(JEEPNEY_ROUTES_DETAILED))

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

  // Smart jeepney state
  const [jeepneyRecommendations, setJeepneyRecommendations] = useState([])
  const [selectedJeepneyRoute, setSelectedJeepneyRoute] = useState(null)
  const [showJeepneyRoutesModal, setShowJeepneyRoutesModal] = useState(false)
  const [showAllRoutes, setShowAllRoutes] = useState(false)

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

  // Smart jeepney route recommendations
  const getSmartJeepneyRecommendations = () => {
    if (!userLocation || !selectedLocation) return

    try {
      console.log("🚌 Getting smart jeepney recommendations...")
      const recommendations = routeOptimizer.current.findOptimalRoutes(
        userLocation,
        selectedLocation,
        0.5, // 500m max walking distance
      )

      console.log(`📋 Generated ${recommendations.length} recommendations`)
      setJeepneyRecommendations(recommendations)

      if (recommendations.length > 0) {
        selectSmartJeepneyRoute(recommendations[0])
      } else {
        setSelectedJeepneyRoute(null)
        setRoutePath([])
        console.log("❌ No viable jeepney routes found")
      }
    } catch (error) {
      console.error("Error getting smart jeepney recommendations:", error)
    }
  }

  // Select smart jeepney route
  const selectSmartJeepneyRoute = (route) => {
    console.log(`🎯 Selected route: ${route.type} - ${route.routeName}`)
    setSelectedJeepneyRoute(route)
    setDirections(route.instructions || [])

    // Set route path based on route type
    if (route.type === "direct" || route.type === "combined-direction") {
      setRoutePath(route.routePath || [])
    } else if (route.type === "transfer") {
      // For transfer routes, we'll handle the visualization in the map component
      setRoutePath([]) // Clear single path since we have multiple segments
    }

    // Set ETA and distance
    const timeMinutes = route.estimatedTime || 30
    setEta({
      jeepney: timeMinutes < 60 ? `${timeMinutes} mins` : `${Math.floor(timeMinutes / 60)} hr ${timeMinutes % 60} mins`,
    })

    const totalDistance = route.walkingDistance + (route.routeDistance || 2)
    setDistance(`${totalDistance.toFixed(1)} km`)

    // Fit map to route
    if (route.routePath && Array.isArray(route.routePath) && route.routePath.length > 0) {
      fitMapToRoute(route.routePath)
    } else if (route.routePath?.firstPath && route.routePath?.secondPath) {
      const combinedPath = [...route.routePath.firstPath, ...route.routePath.secondPath]
      fitMapToRoute(combinedPath)
    }
  }

  // Handle transport mode change
  const handleModeChange = (mode) => {
    setTravelMode(mode)

    if (mode === "book-ride") {
      handleBookRide()
      return
    }

    if (mode === "jeepney" && userLocation && selectedLocation) {
      getSmartJeepneyRecommendations()
    } else if (userLocation && selectedLocation) {
      fetchDirections()
    }
  }

  // Search for places using Google Places API
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

  // Fetch place details using Google Places API
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

  // Fetch directions for different modes using Google Directions API
  const fetchDirections = async () => {
    if (!userLocation || !selectedLocation) {
      console.warn("User location or destination not set")
      return
    }

    setFetchingRoute(true)

    try {
      const modes = ["driving", "walking"]
      const newEta = {}

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
    } catch (error) {
      console.error("Error in fetchDirections:", error)
    } finally {
      setFetchingRoute(false)
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
    setJeepneyRecommendations([])
    setSelectedJeepneyRoute(null)
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
  const getRouteColor = (routeId) => {
    const colors = {
      "1": "#2E8B57",
      "2": "#3CB371",
      "3": "#20B2AA",
      "4": "#32CD32",
      "5": "#66CDAA",
      "6": "#98FB98",
    }
    return colors[routeId] || "#2E8B57"
  }

  // Get route type badge color
  const getRouteTypeBadgeColor = (type) => {
    switch (type) {
      case "direct":
        return "#4CAF50"
      case "combined-direction":
        return "#2196F3"
      case "transfer":
        return "#FF9800"
      default:
        return "#757575"
    }
  }

  // Get route type display name
  const getRouteTypeDisplayName = (route) => {
    switch (route.type) {
      case "direct":
        return "Direct"
      case "combined-direction":
        return "Combined Route"
      case "transfer":
        return "Transfer"
      default:
        return "Route"
    }
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
                <Ionicons name="bus" size={24} color="white" />
              </View>
              <Text style={styles.modalTitle}>All Jeepney Routes</Text>
            </View>
            <TouchableOpacity onPress={() => setShowJeepneyRoutesModal(false)} style={styles.closeButton}>
              <Ionicons name="close-circle" size={24} color="#2E8B57" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.routesList} showsVerticalScrollIndicator={false}>
            {Object.entries(JEEPNEY_ROUTES_DETAILED).map(([id, route]) => {
              const routeColor = getRouteColor(id)
              return (
                <TouchableOpacity
                  key={id}
                  style={[styles.routeCard, { borderLeftColor: routeColor, borderLeftWidth: 4 }]}
                  activeOpacity={0.7}
                >
                  <View style={styles.routeCardContent}>
                    <View style={[styles.routeIconContainer, { backgroundColor: `${routeColor}20` }]}>
                      <Ionicons name="bus" size={20} color={routeColor} />
                    </View>
                    <View style={styles.routeInfo}>
                      <Text style={styles.routeName}>{route.name}</Text>
                      {route.paths.map((path, index) => (
                        <Text key={index} style={styles.routePath}>
                          {path.from} → {path.to}
                        </Text>
                      ))}
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

          {/* Show all routes in the background if enabled */}
          {showAllRoutes &&
            Object.entries(JEEPNEY_ROUTES_DETAILED).map(([routeId, routeDetails]) =>
              routeDetails.paths.map((path, pathIndex) => {
                const routePath = path.via.map((point) => ({
                  latitude: point.lat,
                  longitude: point.lng,
                }))

                return (
                  <Polyline
                    key={`${routeId}-${pathIndex}`}
                    coordinates={routePath}
                    strokeWidth={2}
                    strokeColor={`${getRouteColor(routeId)}60`}
                    lineCap="round"
                    lineJoin="round"
                  />
                )
              }),
            )}

          {/* Route polylines for non-jeepney modes */}
          {routePath.length > 0 && travelMode !== "jeepney" && (
            <Polyline coordinates={routePath} strokeWidth={6} strokeColor="#007bff" lineCap="round" lineJoin="round" />
          )}

          {/* Smart jeepney route visualization */}
          {travelMode === "jeepney" && selectedJeepneyRoute && (
            <>
              {/* Direct routes */}
              {selectedJeepneyRoute.type === "direct" && routePath.length > 0 && (
                <Polyline
                  coordinates={routePath}
                  strokeWidth={6}
                  strokeColor={getRouteColor(selectedJeepneyRoute.routeId)}
                  lineCap="round"
                  lineJoin="round"
                />
              )}

              {/* Combined direction routes - solid line, not dashed */}
              {selectedJeepneyRoute.type === "combined-direction" && routePath.length > 0 && (
                <Polyline
                  coordinates={routePath}
                  strokeWidth={6}
                  strokeColor={getRouteColor(selectedJeepneyRoute.routeId)}
                  lineCap="round"
                  lineJoin="round"
                />
              )}

              {/* Transfer routes with multiple segments */}
              {selectedJeepneyRoute.type === "transfer" && selectedJeepneyRoute.routePath && (
                <>
                  {selectedJeepneyRoute.routePath.firstPath && selectedJeepneyRoute.routePath.firstPath.length > 0 && (
                    <Polyline
                      coordinates={selectedJeepneyRoute.routePath.firstPath}
                      strokeWidth={6}
                      strokeColor={getRouteColor(
                        selectedJeepneyRoute.firstRoute?.routeId || selectedJeepneyRoute.routeId,
                      )}
                      lineCap="round"
                      lineJoin="round"
                    />
                  )}
                  {selectedJeepneyRoute.routePath.secondPath &&
                    selectedJeepneyRoute.routePath.secondPath.length > 0 && (
                      <Polyline
                        coordinates={selectedJeepneyRoute.routePath.secondPath}
                        strokeWidth={6}
                        strokeColor={getRouteColor(
                          selectedJeepneyRoute.secondRoute?.routeId || selectedJeepneyRoute.routeId,
                        )}
                        lineCap="round"
                        lineJoin="round"
                      />
                    )}
                  {selectedJeepneyRoute.routePath.transferPoint && (
                    <Marker coordinate={selectedJeepneyRoute.routePath.transferPoint} title="Transfer Point">
                      <View style={styles.transferMarker}>
                        <Ionicons name="swap-horizontal" size={12} color="#fff" />
                      </View>
                    </Marker>
                  )}
                </>
              )}

              {/* Boarding and alighting points */}
              {selectedJeepneyRoute.boardingPoint && (
                <Marker
                  coordinate={{
                    latitude: selectedJeepneyRoute.boardingPoint.lat || selectedJeepneyRoute.boardingPoint.latitude,
                    longitude: selectedJeepneyRoute.boardingPoint.lng || selectedJeepneyRoute.boardingPoint.longitude,
                  }}
                  title="Board Jeepney"
                >
                  <View style={styles.jeepneyAccessMarker}>
                    <Ionicons name="log-in" size={12} color="#fff" />
                  </View>
                </Marker>
              )}

              {selectedJeepneyRoute.alightingPoint && (
                <Marker
                  coordinate={{
                    latitude: selectedJeepneyRoute.alightingPoint.lat || selectedJeepneyRoute.alightingPoint.latitude,
                    longitude: selectedJeepneyRoute.alightingPoint.lng || selectedJeepneyRoute.alightingPoint.longitude,
                  }}
                  title="Exit Jeepney"
                >
                  <View style={[styles.jeepneyAccessMarker, { backgroundColor: "#FF3B30" }]}>
                    <Ionicons name="log-out" size={12} color="#fff" />
                  </View>
                </Marker>
              )}

              {/* Transfer location marker */}
              {selectedJeepneyRoute.transferLocation && (
                <Marker coordinate={selectedJeepneyRoute.transferLocation} title="Transfer Here">
                  <View style={styles.transferMarker}>
                    <Ionicons name="swap-horizontal" size={12} color="#fff" />
                  </View>
                </Marker>
              )}
            </>
          )}
        </MapView>

        {/* Map controls */}
        <View style={styles.mapControls}>
          <TouchableOpacity
            style={[styles.mapControlButton, showAllRoutes && styles.mapControlButtonActive]}
            onPress={() => setShowAllRoutes(!showAllRoutes)}
          >
            <Ionicons name="git-network" size={20} color={showAllRoutes ? "#fff" : "#333"} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.mapControlButton} onPress={() => setShowJeepneyRoutesModal(true)}>
            <Ionicons name="bus" size={20} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main content */}
      <View style={styles.contentContainer}>
        {/* Search bar */}
        <View style={styles.searchBarContainer}>
          <View style={styles.locationFields}>
            <View style={styles.locationField}>
              <Ionicons name="location" size={18} color="#2E8B57" />
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
          {loading && <ActivityIndicator size="small" color="#2E8B57" style={styles.loading} />}
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
                  {travelMode === "jeepney" && selectedJeepneyRoute
                    ? getRouteTypeDisplayName(selectedJeepneyRoute)
                    : "Optimal"}
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

            <TouchableOpacity
              style={styles.getDirectionsButton}
              onPress={() => {
                if (travelMode === "jeepney") {
                  getSmartJeepneyRecommendations()
                } else {
                  fetchDirections()
                }
              }}
              disabled={fetchingRoute || !userLocation || !selectedLocation}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.getDirectionsButtonText}>{fetchingRoute ? "Calculating..." : "Get Directions"}</Text>
            </TouchableOpacity>
          </View>

          {/* Smart Jeepney Recommendations */}
          {travelMode === "jeepney" && jeepneyRecommendations.length > 0 && (
            <View style={styles.recommendationsSection}>
              <Text style={styles.sectionTitle}>Smart Jeepney Recommendations</Text>
              {jeepneyRecommendations.map((recommendation, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.recommendationCard,
                    selectedJeepneyRoute === recommendation && styles.selectedRecommendationCard,
                  ]}
                  onPress={() => selectSmartJeepneyRoute(recommendation)}
                >
                  <View style={styles.recommendationHeader}>
                    <Ionicons name="bus" size={20} color="#FFC107" />
                    <Text style={styles.recommendationTitle}>
                      {recommendation.routeName}
                      {recommendation.direction && ` (${recommendation.direction})`}
                    </Text>
                    <View
                      style={[
                        styles.recommendationBadge,
                        { backgroundColor: getRouteTypeBadgeColor(recommendation.type) },
                      ]}
                    >
                      <Text style={styles.recommendationBadgeText}>{getRouteTypeDisplayName(recommendation)}</Text>
                    </View>
                  </View>

                  <Text style={styles.recommendationDistance}>
                    Walk {Math.round(recommendation.walkingDistance * 1000)}m total • {recommendation.estimatedTime} min
                    trip
                  </Text>

                  {recommendation.type === "combined-direction" && (
                    <Text style={styles.recommendationSpecial}>
                      ✨ Same jeepney - just stay on as it changes direction
                    </Text>
                  )}

                  {recommendation.type === "transfer" && (
                    <Text style={styles.recommendationTransfer}>
                      🔄 Transfer required • {recommendation.firstRoute?.routeName} →{" "}
                      {recommendation.secondRoute?.routeName}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Directions */}
          {directions.length > 0 && (
            <View style={styles.directionsSection}>
              <Text style={styles.sectionTitle}>
                {travelMode === "jeepney" ? "Jeepney Route Instructions" : "Directions"}
              </Text>
              <View style={styles.directionsPanel}>
                {directions.slice(0, 6).map((step, index) => (
                  <View key={index} style={styles.directionStep}>
                    <View style={styles.directionStepNumber}>
                      <Text style={styles.stepNumberText}>{index + 1}</Text>
                    </View>
                    <View style={styles.directionStepContent}>
                      <Text style={styles.directionText} numberOfLines={3}>
                        {typeof step === "string" ? step : step.instruction}
                      </Text>
                      {step.distance && step.duration && (
                        <Text style={styles.directionMetrics}>
                          {step.distance} • {step.duration}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}

                {directions.length > 6 && (
                  <TouchableOpacity style={styles.viewMoreButton}>
                    <Text style={styles.viewMoreText}>View All Steps</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {renderJeepneyRoutesModal()}
    </SafeAreaView>
  )
}

// Styles remain the same as before, with some additions
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
  mapControls: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "column",
    gap: 8,
  },
  mapControlButton: {
    backgroundColor: "#fff",
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
  },
  mapControlButtonActive: {
    backgroundColor: "#2E8B57",
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
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  selectedRecommendationCard: {
    borderColor: "#2E8B57",
    borderWidth: 2,
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
  recommendationSpecial: {
    fontSize: 14,
    color: "#4CAF50",
    fontWeight: "500",
    marginBottom: 4,
  },
  recommendationTransfer: {
    fontSize: 14,
    color: "#FF9800",
    fontWeight: "500",
  },
  recommendationLoop: {
    fontSize: 14,
    color: "#2196F3",
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
    backgroundColor: "#4CAF50",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  transferMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FF9800",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
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
    marginBottom: 4,
  },
  routePath: {
    fontSize: 12,
    color: "#666",
  },
})
