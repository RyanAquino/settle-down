import type { ConfigContext } from 'expo/config';

const projectId = '3321bf9d-d0da-4c09-922d-39679eb1c683';

export default ({ config }: ConfigContext) => {
  const isE2E = process.env.CI_E2E === '1';

  return {
    ...config,
    owner: 'org-ryan',
    extra: {
      ...config.extra,
      eas: { projectId },
      ...(isE2E && { verifyOfflineImport: true, verifyMissingBackend: true }),
    },
    updates: { url: `https://u.expo.dev/${projectId}`, ...(isE2E ? { enabled: false } : {}) },
    ...(isE2E
      ? {
          ios: {
            ...config.ios,
            infoPlist: {
              ...config.ios?.infoPlist,
              // Expo types arbitrary Info.plist entries as any; preserve the existing dictionary.
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              NSAppTransportSecurity: {
                ...config.ios?.infoPlist?.NSAppTransportSecurity,
                NSAllowsLocalNetworking: true,
              },
            },
          },
        }
      : {}),
  };
};
