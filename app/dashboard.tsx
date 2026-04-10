 import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Platform,
  Animated,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { database, auth } from '@/config/firebase';

// Helper functions to handle location across platforms
const getLocation = async () => {
  if (Platform.OS !== 'web') {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({});
      return location.coords;
    }
    return null;
  } else {
    return new Promise<{ latitude: number; longitude: number; heading?: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, heading: pos.coords.heading || 0 }),
        () => resolve(null)
      );
    });
  }
};

const watchLocation = async (callback: (coords: { latitude: number; longitude: number; heading?: number }) => void) => {
  if (Platform.OS !== 'web') {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    
    return await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      (loc) => {
        callback({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, heading: loc.coords.heading || 0 });
      }
    );
  } else {
    if (!navigator.geolocation) return null;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => callback({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, heading: pos.coords.heading || 0 }),
      () => {},
      { enableHighAccuracy: true }
    );
    return { remove: () => navigator.geolocation.clearWatch(watchId) };
  }
};
import { ref, update, onValue, off, remove } from 'firebase/database';
import { Home, Mail, Clock, Settings, MapPin, Shield } from 'lucide-react-native';
import RideRequestPopup from '@/components/RideRequestPopup';
import RideManagementPanel from '@/components/RideManagementPanel';
import ChatPanel from '@/components/ChatPanel';
import ToastNotification from '@/components/ToastNotification';
import { createGeoFireObject } from '@/utils/geofire';
import { getUnreadCount, listenForClientMessages, autoDeleteReadMessages, watchRideStatusForCleanup } from '@/utils/chat';

const { width, height } = Dimensions.get('window');

export default function Dashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const [userStatus, setUserStatus] = useState<'pending' | 'approved' | 'accepted' | 'rejected'>('accepted');
  const [locationSubscription, setLocationSubscription] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [operationPlace, setOperationPlace] = useState<string>('');
  const [activeTab, setActiveTab] = useState('home');

  const [showRidePopup, setShowRidePopup] = useState(false);
  const [pendingRide, setPendingRide] = useState<any>(null);
  const [activeRide, setActiveRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState<'accepted' | 'arrived' | 'in_progress' | null>(null);
  const [driverData, setDriverData] = useState<any>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [showChatPanel, setShowChatPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [toastData, setToastData] = useState({ clientName: '', message: '' });

  const sliderX = useRef(new Animated.Value(0)).current;
  const SLIDE_WIDTH = width - 40;
  const SLIDE_THRESHOLD = SLIDE_WIDTH * 0.5;

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setIsLoading(false);
      return;
    }

    const userRef = ref(database, `users/${uid}`);
    const statusListener = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setUserStatus(data.status || 'pending');
        setDriverData(data);
        if (data.operation?.place) setOperationPlace(data.operation.place);
        if (data.operation?.available !== undefined) {
          const available = data.operation.available;
          setIsOnline(available);
          sliderX.setValue(available ? SLIDE_WIDTH : 0);
        }
      }
      setIsLoading(false);
    });

    const driverRef = ref(database, `drivers/${uid}`);
    let currentRideUnsubscribe: (() => void) | null = null;

    const driverListener = onValue(driverRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setIsBusy(data.busy || false);
        if (data.currentRide) {
          if (currentRideUnsubscribe) {
            currentRideUnsubscribe();
          }

          const currentRideRef = ref(database, `rides/${data.currentRide}`);
          const rideListener = onValue(currentRideRef, (rideSnapshot) => {
            const rideData = rideSnapshot.val();
            if (rideData) {
              setActiveRide({ id: data.currentRide, ...rideData });
              setRideStatus(rideData.status);
            }
          });

          currentRideUnsubscribe = () => off(currentRideRef, 'value', rideListener);
        } else {
          if (currentRideUnsubscribe) {
            currentRideUnsubscribe();
            currentRideUnsubscribe = null;
          }
          setActiveRide(null);
          setRideStatus(null);
        }
      }
    });

    return () => {
      off(userRef, 'value', statusListener);
      off(driverRef, 'value', driverListener);
      if (currentRideUnsubscribe) {
        currentRideUnsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide?.id) {
      setUnreadCount(0);
      return;
    }

    const rideId = activeRide.id;
    const clientId = activeRide.userId || activeRide.clientId || '';

    const unsubscribeUnread = getUnreadCount(database, rideId, uid, (count) => {
      setUnreadCount(count);
    });

    const unsubscribeMessages = listenForClientMessages(
      database,
      rideId,
      uid,
      (message, messageId) => {
        if (message.senderId !== uid && !showChatPanel) {
          const clientName = activeRide.clientName || activeRide.userName || 'Client';
          setToastData({
            clientName,
            message: message.text,
          });
          setShowToast(true);
        }
      }
    );

    const unsubscribeAutoDelete = autoDeleteReadMessages(database, rideId, clientId, uid);
    const unsubscribeCleanup = watchRideStatusForCleanup(database, rideId);

    return () => {
      unsubscribeUnread();
      unsubscribeMessages();
      unsubscribeAutoDelete();
      unsubscribeCleanup();
    };
  }, [activeRide, showChatPanel]);

  const handleInboxPress = () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide?.id) {
      return;
    }

    const rideStatus = activeRide?.status;
    if (rideStatus !== 'accepted' && rideStatus !== 'arrived' && rideStatus !== 'started') {
      return;
    }

    setShowChatPanel(true);
  };

  const startTracking = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const subscription = await watchLocation(async (coords) => {
      const { latitude, longitude, heading } = coords;

      setCurrentLocation({ latitude, longitude });

      await update(ref(database, `drivers/${uid}/location`), {
        latitude,
        longitude,
        heading: heading || 0,
        updatedAt: Date.now(),
      });

      await update(ref(database, `drivers/${uid}`), {
        lat: latitude,
        lng: longitude,
        lastActive: Date.now(),
      });

      if (isBusy && activeRide) {
        await update(ref(database, `rides/${activeRide.id}/location`), {
          latitude,
          longitude,
        });
      }

      console.log('📍 Driver location updated:', latitude, longitude);
    });
    setLocationSubscription(subscription);
  };

  const stopTracking = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (locationSubscription) {
      try {
        await locationSubscription.remove();
      } catch (error) {
        console.log('Error removing location subscription:', error);
      }
      setLocationSubscription(null);
    }

    await update(ref(database, `drivers/${uid}`), {
      status: 'offline',
    });

    console.log('📍 Driver location tracking stopped');
  };

  const goOnline = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !driverData) return;

    const firstName = driverData.profile?.firstName || '';
    const lastName = driverData.profile?.lastName || '';
    const driverName = `${firstName} ${lastName}`.trim();

    const carBrand = driverData.vehicle?.brand || '';
    const carModelName = driverData.vehicle?.model || '';
    const carColor = driverData.vehicle?.color || '';
    const carModel = carColor && carBrand
      ? `${carColor} • ${carBrand} ${carModelName}`.trim()
      : `${carBrand} ${carModelName}`.trim();

    const plateNumber = driverData.vehicle?.plateNumber || '';
    const photo = driverData.profile?.profilePicture || '';
    const rating = driverData.rating || 5.0;

    const coords = await getLocation();
    if (coords) {
      const { latitude, longitude, heading } = coords;

      await update(ref(database, `drivers/${uid}`), {
        name: driverName,
        plateNumber,
        carModel,
        rating,
        photo,
        status: 'online',
        busy: false,
        lastActive: Date.now(),
        location: {
          latitude,
          longitude,
          heading: heading || 0,
        },
      });
    }

    setIsOnline(true);
    await startTracking();
    await update(ref(database, `users/${uid}/operation`), {
      available: true,
      lastUpdated: Date.now(),
    });

    Animated.spring(sliderX, {
      toValue: SLIDE_WIDTH,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();

    console.log('✅ Driver is now online with full info');
  };

  const goOffline = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setIsOnline(false);
    await stopTracking();
    await update(ref(database, `drivers/${uid}`), {
      status: 'offline',
    });
    await update(ref(database, `users/${uid}/operation`), {
      available: false,
      lastUpdated: Date.now(),
    });

    Animated.spring(sliderX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || isBusy || !isOnline) return;

    const incomingRef = ref(database, `drivers/${uid}/incoming`);
    const incomingListener = onValue(incomingRef, (snapshot) => {
      if (isBusy) return;

      snapshot.forEach((child) => {
        const rideId = child.key;
        if (!rideId) return;

        const rideRef = ref(database, `rides/${rideId}`);
        onValue(rideRef, (rideSnapshot) => {
          const ride = rideSnapshot.val();
          if (ride && ride.status === 'waiting') {
            setPendingRide({ id: rideId, ...ride });
            setShowRidePopup(true);
          }
        });
      });
    });

    return () => off(incomingRef, 'value', incomingListener);
  }, [isBusy, isOnline]);

  const handleAcceptRide = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !pendingRide || !driverData) {
      console.error('❌ Cannot accept ride: missing uid, pendingRide, or driverData');
      return;
    }

    try {
      const firstName = driverData.profile?.firstName || '';
      const lastName = driverData.profile?.lastName || '';
      const driverName = `${firstName} ${lastName}`.trim() || 'Driver';

      const carBrand = driverData.vehicle?.brand || '';
      const carModelName = driverData.vehicle?.model || '';
      const carColor = driverData.vehicle?.color || '';
      const carModel = carColor && carBrand
        ? `${carColor} • ${carBrand} ${carModelName}`.trim()
        : `${carBrand} ${carModelName}`.trim();

      const plateNumber = driverData.vehicle?.plateNumber || '';
      const photo = driverData.profile?.profilePicture || '';
      const rating = driverData.rating || 5.0;

      const driverLat = currentLocation?.latitude || 0;
      const driverLng = currentLocation?.longitude || 0;

      console.log('📝 Updating rideRequests status to accepted...');
      await update(ref(database, `rideRequests/${pendingRide.id}`), {
        status: 'accepted',
        driverId: uid,
        acceptedAt: Date.now(),
      });

      console.log('📝 Updating rides with driver info...');
      await update(ref(database, `rides/${pendingRide.id}`), {
        status: 'accepted',
        acceptedAt: Date.now(),
        driverId: uid,
        driverName,
        plateNumber,
        carModel,
        rating,
        photo,
        location: {
          latitude: driverLat,
          longitude: driverLng,
        },
      });

      console.log('🗑️ Removing from drivers/incoming...');
      await remove(ref(database, `drivers/${uid}/incoming/${pendingRide.id}`));

      console.log('📝 Updating driver status to busy...');
      await update(ref(database, `drivers/${uid}`), {
        busy: true,
        currentRide: pendingRide.id,
      });

      console.log('✅ Ride accepted successfully with all updates complete');

      setShowRidePopup(false);
      setPendingRide(null);
    } catch (error) {
      console.error('❌ Error accepting ride:', error);
    }
  };

  const handleRejectRide = () => {
    setShowRidePopup(false);
    setPendingRide(null);
  };

  const handleCancelRide = () => {
    setShowRidePopup(false);
    setPendingRide(null);
  };

  const handleArrived = async () => {
    if (!activeRide) {
      console.error('❌ Cannot mark arrived: no active ride');
      return;
    }

    try {
      console.log('📝 Updating ride status to arrived...');
      await update(ref(database, `rides/${activeRide.id}`), {
        status: 'arrived',
        arrivedAt: Date.now(),
      });
      console.log('✅ Ride status updated to arrived');
    } catch (error) {
      console.error('❌ Error updating ride to arrived:', error);
    }
  };

  const handleStartTrip = async () => {
    if (!activeRide) {
      console.error('❌ Cannot start trip: no active ride');
      return;
    }

    try {
      console.log('📝 Updating ride status to started...');
      await update(ref(database, `rides/${activeRide.id}`), {
        status: 'started',
        startedAt: Date.now(),
      });
      console.log('✅ Ride status updated to started');
    } catch (error) {
      console.error('❌ Error starting trip:', error);
    }
  };

  const handleCompleteTrip = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide) {
      console.error('❌ Cannot complete trip: missing uid or active ride');
      return;
    }

    try {
      console.log('📝 Updating ride status to completed...');
      await update(ref(database, `rides/${activeRide.id}`), {
        status: 'completed',
        completedAt: Date.now(),
      });

      console.log('📝 Cleaning up messages...');
      await remove(ref(database, `rides/${activeRide.id}/messages`));

      console.log('📝 Updating driver status to available...');
      await update(ref(database, `drivers/${uid}`), {
        busy: false,
        currentRide: null,
      });

      console.log('✅ Trip completed, driver is now available');

      setActiveRide(null);
      setRideStatus(null);
    } catch (error) {
      console.error('❌ Error completing trip:', error);
    }
  };

  const startX = useRef(0);
  const savedTranslateX = useRef(0);

  const gesture = Gesture.Pan()
    .enabled(userStatus === 'approved' || userStatus === 'accepted')
    .onStart(() => {
      savedTranslateX.current = isOnline ? SLIDE_WIDTH : 0;
    })
    .onUpdate((event) => {
      const newValue = Math.max(0, Math.min(savedTranslateX.current + event.translationX, SLIDE_WIDTH));
      sliderX.setValue(newValue);
    })
    .onEnd((event) => {
      const finalPosition = savedTranslateX.current + event.translationX;
      if (finalPosition > SLIDE_THRESHOLD) {
        goOnline();
      } else {
        goOffline();
      }
    });

  useEffect(() => {
    return () => {
      if (locationSubscription) {
        (async () => {
          try {
            await locationSubscription.remove();
          } catch (error) {
            console.log('Error removing location subscription on cleanup:', error);
          }
        })();
      }
    };
  }, [locationSubscription]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#006400" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* RIDE REQUEST POPUP */}
      <RideRequestPopup
        visible={showRidePopup}
        ride={pendingRide}
        onAccept={handleAcceptRide}
        onReject={handleRejectRide}
        onCancel={handleCancelRide}
      />

      {/* RIDE MANAGEMENT PANEL */}
      <RideManagementPanel
        rideStatus={rideStatus}
        rideInfo={activeRide}
        onArrived={handleArrived}
        onStartTrip={handleStartTrip}
        onCompleteTrip={handleCompleteTrip}
      />

      {/* CHAT PANEL */}
      <ChatPanel
        visible={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        rideId={activeRide?.id || null}
        clientName={activeRide?.clientName || activeRide?.userName || 'Client'}
        clientId={activeRide?.userId || activeRide?.clientId || ''}
        driverName={driverData ? `${driverData.profile?.firstName || ''} ${driverData.profile?.lastName || ''}`.trim() || 'Driver' : 'Driver'}
        pickupAddress={activeRide?.pickupAddress || 'Pickup'}
        destinationAddress={activeRide?.destinationAddress || 'Destination'}
        rideStatus={activeRide?.status || null}
      />

      {/* TOAST NOTIFICATION */}
      <ToastNotification
        visible={showToast}
        clientName={toastData.clientName}
        message={toastData.message}
        onHide={() => setShowToast(false)}
      />

      {/* MAP AREA */}
      <View style={styles.mapPlaceholder}>
        <View style={styles.mapBackground}>
          <View style={styles.mapGrid}>
            {Array.from({ length: 20 }).map((_, i) => (
              <View key={i} style={styles.mapLine} />
            ))}
          </View>
          <View style={[styles.mapGrid, styles.mapGridVertical]}>
            {Array.from({ length: 20 }).map((_, i) => (
              <View key={i} style={styles.mapLine} />
            ))}
          </View>
          <View style={styles.serviceRadius} />
        </View>

        <View style={styles.topButtons}>
          <TouchableOpacity style={styles.topButton}>
            <View style={styles.iconCircle}>
              <MapPin color="#333" size={22} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topButton}>
            <View style={styles.iconCircle}>
              <Shield color="#333" size={22} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View
        style={[
          styles.slideContainer,
          (userStatus === 'pending' || userStatus === 'rejected') && styles.disabledSlider,
        ]}
        pointerEvents={(userStatus === 'approved' || userStatus === 'accepted') ? 'auto' : 'none'}
      >
        <View style={[styles.slideTrack, isOnline && styles.slideTrackOnline]}>
          <Text style={styles.slideInstructionText}>
            {isOnline ? 'Slide to go offline' : 'Slide to go online'}
          </Text>
          <GestureDetector gesture={gesture}>
            <Animated.View
              style={[
                styles.slideThumb,
                {
                  transform: [{ translateX: sliderX }],
                },
              ]}
            >
              <Text style={styles.chevronText}>»</Text>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>

      {/* CONTENT */}
      <View style={styles.contentContainer}>
        <View style={styles.scheduledSection}>
          <View style={styles.scheduledIconCircle}>
            <Clock color="#666" size={28} />
          </View>
          <View style={styles.scheduledTextContainer}>
            <Text style={styles.scheduledTitle}>New scheduled requests</Text>
            <Text style={styles.scheduledSubtitle}>Choose a request that suits you</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Today's earnings</Text>
            <Text style={styles.statValue}>£0.00</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Activity score</Text>
            <Text style={styles.statValue}>50%</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Current rating</Text>
            <Text style={styles.statValue}>5.00</Text>
          </View>
        </View>
      </View>

      {/* NAV BAR */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
          <Home color={activeTab === 'home' ? '#4285F4' : '#999'} size={26} />
          <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={handleInboxPress}>
          <View style={styles.iconWrapper}>
            <Mail color={activeTab === 'inbox' ? '#4285F4' : '#999'} size={26} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.navLabel, activeTab === 'inbox' && styles.navLabelActive]}>Inbox</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('trips')}>
          <Clock color={activeTab === 'trips' ? '#4285F4' : '#999'} size={26} />
          <Text style={[styles.navLabel, activeTab === 'trips' && styles.navLabelActive]}>Trips</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('settings')}>
          <Settings color={activeTab === 'settings' ? '#4285F4' : '#999'} size={26} />
          <Text style={[styles.navLabel, activeTab === 'settings' && styles.navLabelActive]}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* BLUR OVERLAY - Only show for pending */}
      {userStatus === 'pending' && (
        <BlurView intensity={90} style={styles.blurOverlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>Your account is under review</Text>
            <Text style={styles.overlayMessage}>Please wait up to 24 hours</Text>
          </View>
        </BlurView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },
  mapPlaceholder: {
    height: height * 0.55,
    backgroundColor: '#E8E8E8',
    position: 'relative',
    overflow: 'hidden',
  },
  mapBackground: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mapGrid: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  mapGridVertical: { flexDirection: 'row' },
  mapLine: { flex: 1, borderWidth: 0.5, borderColor: '#D0D0D0', opacity: 0.3 },
  serviceRadius: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 2,
    borderColor: '#00C853',
    backgroundColor: 'rgba(0, 200, 83, 0.08)',
  },
  topButtons: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topButton: { width: 44, height: 44 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  slideContainer: {
    position: 'absolute',
    top: height * 0.55 - 30,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 0,
  },
  slideTrack: {
    height: 60,
    backgroundColor: '#00C853',
    borderRadius: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  slideTrackOnline: {
    backgroundColor: '#E53935',
  },
  slideInstructionText: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  slideThumb: {
    position: 'absolute',
    left: 5,
    top: 5,
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  chevronText: {
    color: '#00C853',
    fontSize: 32,
    fontWeight: '700',
  },
  disabledSlider: {
    opacity: 0.5,
  },
  /* CONTENT BELOW */
  contentContainer: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 40,
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  scheduledSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    marginBottom: 20,
  },
  scheduledIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E8E8E8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  scheduledTextContainer: { flex: 1 },
  scheduledTitle: { fontSize: 16, fontWeight: '600', color: '#2C2C2C', marginBottom: 4 },
  scheduledSubtitle: { fontSize: 13, color: '#888' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
  },
  statLabel: { fontSize: 11, color: '#888', marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#000' },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 85,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
    paddingTop: 8,
  },
  navItem: { alignItems: 'center', justifyContent: 'center' },
  iconWrapper: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  navLabel: { fontSize: 11, color: '#999', marginTop: 6 },
  navLabelActive: { color: '#4285F4', fontWeight: '600' },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  overlayCard: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    paddingVertical: 36,
    paddingHorizontal: 28,
    borderRadius: 20,
    alignItems: 'center',
  },
  overlayTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  overlayMessage: { fontSize: 15, color: '#666', textAlign: 'center' },
});



