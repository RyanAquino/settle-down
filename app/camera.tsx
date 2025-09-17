import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { useState, useRef, useEffect } from 'react';
import { Button, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

export default function CameraScreen() {
  const [facing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const params = useLocalSearchParams();

  useEffect(() => {
    // Show success message if photo was saved offline
    if (params.message) {
      Alert.alert('Success', params.message as string);
    }

    // Show error message if saving failed
    if (params.error) {
      Alert.alert('Error', params.error as string);
    }
  }, [params.message, params.error]);

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <Button onPress={requestPermission} title="Grant permission" />
      </View>
    );
  }


  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1,
          base64: false,
          skipProcessing: true,
          shutterSound: false,
        });

        if (photo?.uri) {
          // Navigate to loading page with photo URI
          router.push({
            pathname: '/loading',
            params: {
              photoUri: photo.uri
            }
          });
        }
      } catch {
        // Failed to take picture
        Alert.alert('Error', 'Failed to take picture. Please try again.');
      }
    }
  };

  const pickFromLibrary = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permissionResult.status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'This app needs access to your photo library to select images. Please enable photo library access in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => ImagePicker.requestMediaLibraryPermissionsAsync() }
          ]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'Images',
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const photoUri = result.assets[0].uri;

        router.push({
          pathname: '/loading',
          params: {
            photoUri: photoUri,
            fromLibrary: 'true'
          }
        });
      }
    } catch {
      Alert.alert('Error', 'Failed to pick photo from library. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="picture"
        pictureSize="High"
        videoQuality="4:3"
        ratio="4:3"
      />
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.libraryButton}
          onPress={pickFromLibrary}
        >
          <Text style={styles.libraryButtonText}>📷</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.captureButton}
          onPress={takePicture}
        >
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        <View style={styles.spacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 50,
    paddingBottom: 50,
    height: 150,
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderWidth: 3,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
  },
  text: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  libraryButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  libraryButtonText: {
    fontSize: 24,
  },
  spacer: {
    width: 50,
    height: 50,
  },
});