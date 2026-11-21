/* global expect, test */
const withReceiptReminderTimeZone = require('../plugins/with-receipt-reminder-time-zone');

test('Android prebuild keeps one Expo dispatcher and registers it for time-zone changes and reboot', async () => {
  const { mods } = withReceiptReminderTimeZone({});
  const modRequest = { platform: 'android', modName: 'manifest', projectRoot: process.cwd() };
  const modResults = {
    manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] },
  };
  await mods.android.manifest({ modResults, modRequest });
  await mods.android.manifest({ modResults, modRequest });

  const receivers = modResults.manifest.application[0].receiver;
  expect(receivers).toHaveLength(2);
  expect(receivers[0].$).toEqual({
    'android:name': 'expo.modules.notifications.service.NotificationsService',
    'tools:node': 'remove',
  });
  expect(receivers[1].$['android:exported']).toBe('false');
  const actions = receivers[1]['intent-filter'].flatMap((filter) =>
    filter.action.map((action) => action.$['android:name']),
  );
  expect(actions).toEqual(
    expect.arrayContaining([
      'expo.modules.notifications.NOTIFICATION_EVENT',
      'android.intent.action.TIMEZONE_CHANGED',
      'android.intent.action.BOOT_COMPLETED',
      'android.intent.action.MY_PACKAGE_REPLACED',
    ]),
  );
});
