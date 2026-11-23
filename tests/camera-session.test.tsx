import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import type { CameraViewProps } from 'expo-camera';
import { CameraSession } from '@/components/camera-session';

jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CameraView: (props: CameraViewProps) => <View {...props} testID="mock-camera" />,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

test('the flash button cycles through all three capture modes', async () => {
  const user = userEvent.setup();
  await render(<CameraSession onPickFromLibrary={jest.fn()} />);
  const camera = screen.getByTestId('mock-camera');
  expect(camera).toHaveProp('flash', 'off');
  for (const [current, next] of [
    ['off', 'auto'],
    ['auto', 'on'],
    ['on', 'off'],
  ]) {
    await user.press(screen.getByRole('button', { name: `Flash ${current}` }));
    expect(camera).toHaveProp('flash', next);
    expect(screen.getByRole('button', { name: `Flash ${next}` })).toBeOnTheScreen();
  }
});

function pinchEvent(distance: number, timeStamp: number) {
  const touches = [
    { pageX: 0, pageY: 0 },
    { pageX: distance, pageY: 0 },
  ];
  return {
    nativeEvent: { touches },
    touchHistory: { numberActiveTouches: 2, mostRecentTimeStamp: timeStamp, touchBank: [] },
  };
}

test('the preview still zooms in and out with a pinch', async () => {
  await render(<CameraSession onPickFromLibrary={jest.fn()} />);
  expect(screen.getByText('Pinch to zoom')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /zoom/i })).toBeNull();
  const camera = screen.getByTestId('mock-camera');
  const preview = screen.getByTestId('camera-preview').props as Record<
    'onResponderGrant' | 'onResponderMove' | 'onResponderRelease',
    (event: ReturnType<typeof pinchEvent>) => void
  >;
  await fireEvent(camera, 'cameraReady');
  await act(() => {
    preview.onResponderGrant(pinchEvent(50, 1));
    preview.onResponderMove(pinchEvent(100, 2));
  });
  expect(camera.props.zoom).toBeGreaterThan(0);
  await act(() => {
    preview.onResponderMove(pinchEvent(50, 3));
    preview.onResponderRelease(pinchEvent(50, 4));
  });
  expect(camera).toHaveProp('zoom', 0);
});
