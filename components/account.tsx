import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

const profileSchema = z.object({
  email: z.string(),
  remaining: z.number().int().nonnegative().nullable(),
  resets_at: z.string(),
});
const sessionSchema = profileSchema.extend({ token: z.string().min(1) });
type Session = z.infer<typeof sessionSchema>;
type Profile = z.infer<typeof profileSchema>;
const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
const storageKey = 'settledown.account.v1';

function call(path: string, options?: RequestInit, token?: string) {
  if (!apiBase) throw new Error('The backend address is missing from this build.');
  const base = new URL(apiBase);
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  ) {
    throw new Error('Use an HTTPS backend address to sign in.');
  }
  const headers = new Headers(options?.headers);
  headers.set('ngrok-skip-browser-warning', 'true');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return fetch(apiBase + '/api/v1/' + path, { ...options, headers });
}

type Account = {
  ready: boolean;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  request: (path: string, options?: RequestInit) => Promise<Response>;
  refresh: () => Promise<void>;
};
const Context = createContext<Account | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const token = session?.token;
  const bearer = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(storageKey)
      .then((value) => {
        if (active && value) {
          const session = sessionSchema.parse(JSON.parse(value));
          bearer.current = session.token;
          setSession(session);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const clear = useCallback(async (token: string) => {
    if (bearer.current !== token) return;
    bearer.current = null;
    try {
      await SecureStore.deleteItemAsync(storageKey);
    } finally {
      setSession(null);
    }
  }, []);

  const signIn = async (email: string, password: string) => {
    const response = await call('auth/sign-in/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Check your Settle Up email and password.'
          : response.status === 429
            ? 'Too many attempts. Try again later.'
            : 'Sign-in is temporarily unavailable.',
      );
    const session: Session = sessionSchema.parse(await response.json());
    await SecureStore.setItemAsync(storageKey, JSON.stringify(session), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    bearer.current = session.token;
    setSession(session);
  };

  const request = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!token || token !== bearer.current) throw new Error('Please sign in.');
      const response = await call(path, options, token);
      if (response.status === 401) await clear(token);
      return response;
    },
    [clear, token],
  );

  const refresh = useCallback(async () => {
    const token = bearer.current;
    if (!token) return;
    const response = await request('auth/me/');
    if (response.ok) {
      const updated = profileSchema.parse(await response.json());
      if (bearer.current === token) setSession({ ...updated, token });
    }
  }, [request]);

  const signOut = async () => {
    const token = bearer.current;
    if (!token) return;
    const response = await request('auth/sign-out/', { method: 'POST' });
    if (response.ok || response.status === 401) await clear(token);
    else throw new Error('Sign-out failed. Please try again.');
  };
  return (
    <Context.Provider value={{ ready, profile: session, signIn, signOut, request, refresh }}>
      {children}
    </Context.Provider>
  );
}

export function useAccount() {
  const account = useContext(Context);
  if (!account) throw new Error('AccountProvider is required.');
  return account;
}
