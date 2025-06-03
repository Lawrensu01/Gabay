import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Modal, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { searchPlacesByCategory, getPlaceDetails, getPlacePhotoUrl } from '../services/googlePlacesApi';

// Categories for the tabs
const categories = [
  { id: 'coffee', name: 'Coffee Shops' },
  { id: 'restaurants', name: 'Restaurants' },
  { id: 'malls', name: 'Shopping Malls' },
];

const PlacesTab = () => {
  const [activeCategory, setActiveCategory] = useState('coffee');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const navigation = useNavigation();
  const [places, setPlaces] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch places when activeCategory changes
  useEffect(() => {
    const fetchPlaces = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const placesData = await searchPlacesByCategory(activeCategory);
        setPlaces(placesData);
      } catch (err) {
        console.error('Error fetching places:', err);
        setError('Failed to load places. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlaces();
  }, [activeCategory]);

  const handlePlacePress = async (place) => {
    try {
      setIsLoading(true);
      const detailedPlace = await getPlaceDetails(place.id);
      setSelectedPlace(detailedPlace);
      setShowDetails(true);
    } catch (err) {
      console.error('Error fetching place details:', err);
      alert('Failed to load place details. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = (place) => {
    setShowDetails(false);
    // Create a destination object that will be properly parsed by navigation.js
    const destination = {
      name: place.name,
      location: place.location || place.vicinity || 'Bacolod City',
      coordinates: {
        latitude: place.coordinates.latitude,
        longitude: place.coordinates.longitude
      }
    };
    
    // Navigate to the Navigation screen with the place info
    navigation.navigate('Search', { 
      selectedDestination: JSON.stringify(destination)
    });
  };

  const renderPlaceCard = (place) => (
    <TouchableOpacity 
      key={place.id} 
      style={styles.placeCard}
      onPress={() => handlePlacePress(place)}
      activeOpacity={0.95}
    >
      <View style={styles.imageContainer}>
        <Image 
          source={{ 
            uri: place.photoReference 
              ? getPlacePhotoUrl(place.photoReference) 
              : 'https://via.placeholder.com/400x200.png?text=No+Image+Available'
          }} 
          style={styles.placeImage}
          resizeMode="cover"
        />
        {place.accessibility && (
          <View style={styles.pwdBadge}>
            <Ionicons name="accessibility" size={14} color="#fff" />
            <Text style={styles.pwdBadgeText}>PWD Friendly</Text>
          </View>
        )}
      </View>
      <View style={styles.placeInfo}>
        <Text style={styles.placeName}>{place.name}</Text>
        <View style={styles.locationContainer}>
          <Ionicons name="location-outline" size={14} color="#40B59F" />
          <Text style={styles.placeLocation}>{place.location || place.vicinity || 'Bacolod City'}</Text>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={14} color="#FFB800" />
            <Text style={styles.rating}>{place.rating?.toFixed(1) || 'N/A'}</Text>
          </View>
          <View style={styles.divider} />
          <Text style={styles.openStatus}>
            {place.openNow ? 'Open Now' : 'Hours N/A'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderPlaceDetails = () => (
    <Modal
      visible={showDetails}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowDetails(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <View style={styles.modalImageContainer}>
            <Image 
              source={{ 
                uri: selectedPlace?.photoReference 
                  ? getPlacePhotoUrl(selectedPlace.photoReference, 800) 
                  : 'https://via.placeholder.com/800x400.png?text=No+Image+Available' 
              }} 
              style={styles.modalImage}
              resizeMode="cover"
            />
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={14} color="#fff" />
              <Text style={styles.ratingBadgeText}>{selectedPlace?.rating}</Text>
            </View>
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowDetails(false)}
            >
              <Ionicons name="close" size={22} color="#666" />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalScrollContent}>
            <Text style={styles.modalTitle}>{selectedPlace?.name}</Text>
            
            <View style={styles.detailsContainer}>
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="location-outline" size={18} color="#40B59F" />
                </View>
                <Text style={styles.detailText}>{selectedPlace?.location}</Text>
              </View>
              
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="time-outline" size={18} color="#40B59F" />
                </View>
                <Text style={styles.detailText}>{selectedPlace?.openingHours}</Text>
              </View>
              
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Ionicons name="call-outline" size={18} color="#40B59F" />
                </View>
                <Text style={styles.detailText}>{selectedPlace?.contact}</Text>
              </View>
            </View>
            
            {selectedPlace?.accessibility && (
              <>
                <View style={styles.separator} />
                
                <Text style={styles.descriptionTitle}>Accessibility Features</Text>
                
                <View style={styles.accessibilityContainer}>
                  {selectedPlace.accessibility.wheelchair && (
                    <View style={styles.accessibilityItem}>
                      <View style={styles.accessibilityIcon}>
                        <Ionicons name="accessibility" size={18} color="#40B59F" />
                      </View>
                      <Text style={styles.accessibilityText}>Wheelchair Accessible</Text>
                    </View>
                  )}
                  
                  {selectedPlace.accessibility.elevators && (
                    <View style={styles.accessibilityItem}>
                      <View style={styles.accessibilityIcon}>
                        <Ionicons name="arrow-up" size={18} color="#40B59F" />
                      </View>
                      <Text style={styles.accessibilityText}>Elevators Available</Text>
                    </View>
                  )}
                  
                  {selectedPlace.accessibility.restrooms && (
                    <View style={styles.accessibilityItem}>
                      <View style={styles.accessibilityIcon}>
                        <Ionicons name="water" size={18} color="#40B59F" />
                      </View>
                      <Text style={styles.accessibilityText}>Accessible Restrooms</Text>
                    </View>
                  )}
                  
                  {selectedPlace.accessibility.parking && (
                    <View style={styles.accessibilityItem}>
                      <View style={styles.accessibilityIcon}>
                        <Ionicons name="car" size={18} color="#40B59F" />
                      </View>
                      <Text style={styles.accessibilityText}>Dedicated Parking</Text>
                    </View>
                  )}
                  
                  {selectedPlace.accessibility.braille && (
                    <View style={styles.accessibilityItem}>
                      <View style={styles.accessibilityIcon}>
                        <Ionicons name="document-text" size={18} color="#40B59F" />
                      </View>
                      <Text style={styles.accessibilityText}>Braille Signage</Text>
                    </View>
                  )}
                  
                  {selectedPlace.accessibility.staffAssistance && (
                    <View style={styles.accessibilityItem}>
                      <View style={styles.accessibilityIcon}>
                        <Ionicons name="people" size={18} color="#40B59F" />
                      </View>
                      <Text style={styles.accessibilityText}>Staff Assistance Available</Text>
                    </View>
                  )}
                </View>
              </>
            )}
            
            <View style={styles.separator} />
            
            <Text style={styles.descriptionTitle}>About</Text>
            <Text style={styles.description}>{selectedPlace?.description}</Text>
            
            <TouchableOpacity 
              style={styles.navigateButton}
              onPress={() => selectedPlace && handleNavigate(selectedPlace)}
            >
              <Ionicons name="navigate" size={20} color="#fff" />
              <Text style={styles.navigateButtonText}>Navigate to Location</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // Function to get the icon name for each category
  const getCategoryIcon = (id) => {
    switch (id) {
      case 'coffee':
        return 'cafe-outline';
      case 'restaurants':
        return 'restaurant-outline';
      case 'malls':
        return 'cart-outline';
      default:
        return 'location-outline';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeText}>Welcome to Gabay!</Text>
        <Text style={styles.title}>Discover places in Bacolod City</Text>
      </View>
      
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroll}
        contentContainerStyle={styles.categoryScrollContent}
      >
        {categories.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryTab,
              activeCategory === category.id && styles.activeCategoryTab
            ]}
            onPress={() => setActiveCategory(category.id)}
            activeOpacity={0.8}
          >
            <Ionicons 
              name={getCategoryIcon(category.id)} 
              size={18} 
              color={activeCategory === category.id ? '#fff' : '#40B59F'} 
              style={styles.categoryIcon}
            />
            <Text style={[
              styles.categoryText,
              activeCategory === category.id && styles.activeCategoryText
            ]}>
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView 
        style={styles.placesContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.placesContentContainer}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#40B59F" />
            <Text style={styles.loadingText}>Loading places...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#ff6b6b" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : places.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={48} color="#aaa" />
            <Text style={styles.emptyText}>No places found in this category</Text>
          </View>
        ) : (
          places.map(place => renderPlaceCard(place))
        )}
      </ScrollView>

      {renderPlaceDetails()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 300,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6c757d',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 300,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#ff6b6b',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 300,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    padding: 24,
    paddingBottom: 18,
    backgroundColor: '#fff',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 3,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#40B59F',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6c757d',
    letterSpacing: 0.2,
  },
  categoryScroll: {
    maxHeight: 64,
    marginTop: 16,
    marginBottom: 8,
  },
  categoryScrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  categoryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginRight: 12,
    borderRadius: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  activeCategoryTab: {
    backgroundColor: '#40B59F',
    borderColor: '#40B59F',
  },
  categoryIcon: {
    marginRight: 8,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6c757d',
  },
  activeCategoryText: {
    color: '#fff',
  },
  placesContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  placesContentContainer: {
    paddingBottom: 24,
  },
  placeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 20,
    overflow: 'hidden',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: 180,
  },
  placeImage: {
    width: '100%',
    height: '100%',
  },
  placeInfo: {
    padding: 16,
  },
  placeName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#343a40',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  placeLocation: {
    fontSize: 14,
    color: '#6c757d',
    marginLeft: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 14,
    color: '#343a40',
    fontWeight: '600',
    marginLeft: 6,
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: '#e9ecef',
    marginHorizontal: 12,
  },
  openStatus: {
    fontSize: 12,
    color: '#28a745',
    fontWeight: '500',
  },
  pwdBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#40B59F',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  pwdBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 6,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 24,
    width: '90%',
    maxHeight: '90%',
    overflow: 'hidden',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 15,
  },
  modalImageContainer: {
    position: 'relative',
    width: '100%',
    height: 220,
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  ratingBadge: {
    position: 'absolute',
    right: 16,
    top: 16,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFB800',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 6,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    zIndex: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 30,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 5,
  },
  modalScrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#343a40',
    marginBottom: 20,
    marginTop: 20,
    paddingHorizontal: 20,
    letterSpacing: -0.5,
  },
  detailsContainer: {
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(64, 181, 159, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  detailText: {
    fontSize: 16,
    color: '#6c757d',
    flex: 1,
    letterSpacing: 0.1,
  },
  separator: {
    height: 1,
    backgroundColor: '#e9ecef',
    marginVertical: 20,
    marginHorizontal: 20,
  },
  descriptionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#343a40',
    marginBottom: 12,
    paddingHorizontal: 20,
    letterSpacing: -0.3,
  },
  description: {
    fontSize: 16,
    color: '#6c757d',
    marginBottom: 24,
    lineHeight: 24,
    paddingHorizontal: 20,
    letterSpacing: 0.1,
  },
  accessibilityContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  accessibilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  accessibilityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(64, 181, 159, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  accessibilityText: {
    fontSize: 15,
    color: '#6c757d',
    fontWeight: '500',
    flex: 1,
    letterSpacing: 0.1,
  },
  navigateButton: {
    backgroundColor: '#40B59F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    margin: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  navigateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 0.2,
  },
});

export default PlacesTab; 