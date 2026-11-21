const { copyFile, mkdir } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const { Manifest } = AndroidConfig;
const expoReceiver = 'expo.modules.notifications.service.NotificationsService';
const receiptReceiver = 'com.ryan.aquino.settledown.reminders.ReceiptReminderNotificationsService';

module.exports = function withReceiptReminderTimeZone(config) {
  config = withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    Manifest.ensureToolsAvailable(manifest);
    const app = Manifest.getMainApplicationOrThrow(manifest);
    const expoRoot = dirname(require.resolve('expo-notifications/package.json'));
    const library = await Manifest.readAndroidManifestAsync(
      join(expoRoot, 'android/src/main/AndroidManifest.xml'),
    );
    const original = library.manifest.application[0].receiver.find((receiver) =>
      [expoReceiver, '.service.NotificationsService'].includes(receiver.$['android:name']),
    );
    if (!original) throw new Error('Cannot find the Expo notifications receiver.');

    // Preserve the installed library's intent filters (including reboot/upgrade restoration).
    // Expo locates its receiver by intent, so there must be exactly one matching receiver.
    app.receiver = [
      ...(app.receiver ?? []).filter(
        (receiver) => ![expoReceiver, receiptReceiver].includes(receiver.$['android:name']),
      ),
      { $: { 'android:name': expoReceiver, 'tools:node': 'remove' } },
      {
        ...original,
        $: { ...original.$, 'android:name': receiptReceiver },
        'intent-filter': [
          ...original['intent-filter'],
          { action: [{ $: { 'android:name': 'android.intent.action.TIMEZONE_CHANGED' } }] },
        ],
      },
    ];
    return config;
  });

  return withDangerousMod(config, [
    'android',
    async (config) => {
      const destination =
        join(
          config.modRequest.platformProjectRoot,
          'app/src/main/java',
          ...receiptReceiver.split('.'),
        ) + '.java';
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(__dirname, 'ReceiptReminderNotificationsService.java'), destination);
      return config;
    },
  ]);
};
