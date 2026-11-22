import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { subscribeToVerifiedDeliveries } from '@/utils/verify-reminder-presentation';
import { theme, type } from '@/utils/theme';

export default function VerifyReminderDelivery({ draftId }: { draftId: string }) {
  const [observations, setObservations] = useState<{ identifier: string; description: string }[]>(
    [],
  );
  useEffect(
    () =>
      subscribeToVerifiedDeliveries(({ identifier, openDraftId, description }) => {
        if (openDraftId === draftId) {
          setObservations((previous) => [...previous.slice(-1), { identifier, description }]);
        }
      }),
    [draftId],
  );
  return observations.map(({ identifier, description }) => (
    <Text key={identifier} style={{ ...type.label, color: theme.ink }}>
      {description}
    </Text>
  ));
}
