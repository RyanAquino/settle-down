import type { ConfigContext } from 'expo/config';

// The app is published to two EAS projects: the personal one, and a copy in the
// org-ryan organization so org members can open its updates in Expo Go.
// EAS_PROJECT_OWNER picks which project eas-cli, updates and native builds use.
// Everything else comes from app.json.
const EAS_PROJECT_IDS = {
  'ryan.aquino': '654ebccb-5edc-4718-ac0d-233e6743c8b0',
  'org-ryan': '3321bf9d-d0da-4c09-922d-39679eb1c683',
};

type Owner = keyof typeof EAS_PROJECT_IDS;

function isOwner(value: string): value is Owner {
  return Object.hasOwn(EAS_PROJECT_IDS, value);
}

export default ({ config }: ConfigContext) => {
  const owner = process.env.EAS_PROJECT_OWNER || 'ryan.aquino';
  if (!isOwner(owner)) {
    throw new Error(
      `Unknown EAS_PROJECT_OWNER "${owner}". Expected one of: ${Object.keys(EAS_PROJECT_IDS).join(', ')}`
    );
  }
  const projectId = EAS_PROJECT_IDS[owner];

  return {
    ...config,
    owner,
    extra: { ...config.extra, eas: { projectId } },
    updates: { url: `https://u.expo.dev/${projectId}` },
  };
};
