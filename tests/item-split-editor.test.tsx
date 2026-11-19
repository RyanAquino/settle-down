import { render, screen, userEvent } from '@testing-library/react-native';
import ItemSplitEditor from '../components/item-split-editor';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

test('quantity splits can be saved after the last unit is assigned', async () => {
  const onSave = jest.fn();
  const user = userEvent.setup();
  await render(
    <ItemSplitEditor
      item={{
        english_name: 'Beer',
        japanese_name: 'ビール',
        item_order: 1,
        quantity: 3,
        cost: 900,
        discount: 0,
      }}
      users={[
        { id: 'aya', name: 'Aya' },
        { id: 'ren', name: 'Ren' },
      ]}
      currency="JPY"
      onCancel={jest.fn()}
      onSave={onSave}
    />,
  );

  await user.press(screen.getByRole('tab', { name: 'By quantity' }));
  await user.press(screen.getByRole('button', { name: 'Add one to Aya' }));
  await user.press(screen.getByRole('button', { name: 'Add one to Ren' }));
  expect(screen.getByText('1 of 3 left to assign')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();

  await user.press(screen.getByRole('button', { name: 'Add one to Ren' }));
  expect(screen.getByRole('button', { name: 'Add one to Aya' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Done' }));
  expect(onSave).toHaveBeenCalledWith({
    mode: 'quantity',
    portions: [
      { memberId: 'aya', units: 1 },
      { memberId: 'ren', units: 2 },
    ],
  });
});
