const PermissionsScreen = () => {
  const router = useRouter();
  const [permissions, setPermissions] = useState({
    location: false,
    camera: false
  });

  useEffect(() => {
    checkCurrentPermissions();
  }, []);

  const checkCurrentPermissions = async () => {
    const currentPermissions = await checkPermissions();
    setPermissions(currentPermissions);
  };

  const handleRequestPermission = async (type) => {
    const results = await requestPermissions();
    setPermissions(results);
  };

  const handleContinue = () => {
    if (permissions.location && permissions.camera) {
      router.replace('home');
    } else {
      alert('Please enable location and camera permissions to use the app');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>App Permissions</Text>
        <Text style={styles.subtitle}>
          To provide you with the best experience, we need the following permissions:
        </Text>
      </View>

      <View style={styles.permissionsList}>
        <PermissionItem
          title="Location"
          description="Required to show accessibility information on the map near you"
          icon="location-outline"
          granted={permissions.location}
          onRequest={() => handleRequestPermission('location')}
        />

        <PermissionItem
          title="Camera"
          description="Required to take photos of accessibility features"
          icon="camera-outline"
          granted={permissions.camera}
          onRequest={() => handleRequestPermission('camera')}
        />
      </View>

      <TouchableOpacity 
        style={[
          styles.continueButton,
          !Object.values(permissions).every(Boolean) && styles.continueButtonDisabled
        ]}
        onPress={handleContinue}
        disabled={!Object.values(permissions).every(Boolean)}
      >
        <Text style={styles.continueButtonText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
};

export default PermissionsScreen; 