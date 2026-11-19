const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { withAndroidManifest, withAndroidStyles, XML } = require('expo/config-plugins');

const cameraFeatures = ['android.hardware.camera', 'android.hardware.camera.autofocus'];
const splashTheme = 'Theme.App.SplashScreen';
const splashBehavior = 'android:windowSplashScreenBehavior';

module.exports = function withAndroidResources(config) {
  config = withAndroidManifest(config, (config) => {
    const { manifest } = config.modResults;
    const features = manifest['uses-feature'] ?? [];
    // Library import is available when the rear camera cannot start.
    manifest['uses-feature'] = [
      ...features.filter((feature) => !cameraFeatures.includes(feature.$['android:name'])),
      ...cameraFeatures.map((name) => ({
        $: { 'android:name': name, 'android:required': 'false' },
      })),
    ];
    return config;
  });

  // Register before expo-splash-screen so this mod runs after its generated styles.
  return withAndroidStyles(config, async (config) => {
    const splash = config.modResults.resources.style?.find(({ $ }) => $.name === splashTheme);
    if (!splash?.item.some(({ $ }) => $.name === splashBehavior)) return config;

    const items = splash.item;
    splash.item = items.filter(({ $ }) => $.name !== splashBehavior);

    // Preserve the generated theme, gating its Android 13 attribute by resource version.
    if (!config.modRequest.introspect) {
      const directory = join(config.modRequest.platformProjectRoot, 'app/src/main/res/values-v33');
      await mkdir(directory, { recursive: true });
      await XML.writeXMLAsync({
        path: join(directory, 'settle_down_splash.xml'),
        xml: { resources: { style: [{ ...splash, item: items }] } },
      });
    }
    return config;
  });
};
