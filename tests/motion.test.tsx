import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { PressableScale } from '../components/motion';

test('accessible button activates once and stops activating when disabled', async () => {
  const onPress = jest.fn();
  const user = userEvent.setup();
  const { rerender } = await render(
    <PressableScale accessibilityLabel="Send transaction" haptic="none" onPress={onPress}>
      <Text>Send</Text>
    </PressableScale>,
  );
  await user.press(screen.getByRole('button', { name: 'Send transaction' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  await rerender(
    <PressableScale accessibilityLabel="Send transaction" haptic="none" disabled onPress={onPress}>
      <Text>Send</Text>
    </PressableScale>,
  );
  expect(screen.getByRole('button', { name: 'Send transaction' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Send transaction' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});
