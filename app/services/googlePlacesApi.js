import axios from 'axios';

const API_KEY = 'AlzaSyuXryjNYbGxgqXXsY8cgTEnntUZn7XnnLA'; // Replace with your actual API key

// Base URL for Google Places API
const API_BASE_URL = 'https://maps.gomaps.pro/maps/api/place';

// Search for places in Bacolod by category
export const searchPlacesByCategory = async (category) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/textsearch/json`, {
      params: {
        query: `${category} in Bacolod City`,
        key: API_KEY,
        region: 'ph'
      }
    });
    
    return response.data.results.map(place => ({
      id: place.place_id,
      name: place.name,
      location: place.formatted_address,
      rating: place.rating || 0,
      coordinates: {
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng
      },
      // We'll get photos separately
      photoReference: place.photos?.[0]?.photo_reference
    }));
  } catch (error) {
    console.error('Error fetching places:', error);
    throw error;
  }
};

// Get detailed info for a specific place
export const getPlaceDetails = async (placeId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/details/json`, {
      params: {
        place_id: placeId,
        key: API_KEY,
        fields: 'name,formatted_address,rating,formatted_phone_number,opening_hours,url,photo,geometry,wheelchair_accessible_entrance'
      }
    });
    
    const place = response.data.result;
    
    return {
      id: place.place_id,
      name: place.name,
      location: place.formatted_address,
      rating: place.rating || 0,
      description: place.editorial_summary?.overview || `${place.name} in Bacolod City`,
      openingHours: place.opening_hours?.weekday_text?.[0] || 'Call for hours',
      contact: place.formatted_phone_number || 'Not available',
      coordinates: {
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng
      },
      photoReference: place.photos?.[0]?.photo_reference,
      accessibility: {
        wheelchair: place.wheelchair_accessible_entrance || false,
        elevators: false,
        restrooms: false,
        parking: false,
        braille: false,
        staffAssistance: false
      }
    };
  } catch (error) {
    console.error('Error fetching place details:', error);
    throw error;
  }
};

// Get photo URL for a place
export const getPlacePhotoUrl = (photoReference, maxWidth = 400) => {
  if (!photoReference) return null;
  return `${API_BASE_URL}/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${API_KEY}`;
}; 