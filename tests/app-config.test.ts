import configure from '@/app.config';

afterEach(() => jest.restoreAllMocks());

it('targets the org even when an older environment selects the personal project', () => {
  jest.replaceProperty(process, 'env', { ...process.env, EAS_PROJECT_OWNER: 'ryan.aquino' });
  const config = configure({
    config: { name: 'Settle Down', slug: 'settle-down' },
    projectRoot: process.cwd(),
    staticConfigPath: null,
    packageJsonPath: null,
  });

  const orgProjectId = '3321bf9d-d0da-4c09-922d-39679eb1c683';
  expect(config.owner).toBe('org-ryan');
  expect(config.extra.eas.projectId).toBe(orgProjectId);
  expect(config.updates.url).toBe(`https://u.expo.dev/${orgProjectId}`);
});
