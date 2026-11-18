// Match the fixture server's IPv4-only loopback listener. Avoid localhost DNS
// selection differing between Node, the simulator, and hosted macOS runners.
export const FIXTURE_ORIGIN = 'http://127.0.0.1:8765';

export async function fixtureControl(
  route,
  { token, body, signal, port = 8765, timeout = 5000 } = {},
) {
  if (!['/__reset', '/__requests'].includes(route))
    throw new Error('Invalid fixture control route');
  if (!token) throw new Error('Fixture control token is required');
  try {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    // Include the operation, but never the authorization header or request body.
    throw new Error(`Fixture control ${route} failed: ${error.message}`, { cause: error });
  }
}
