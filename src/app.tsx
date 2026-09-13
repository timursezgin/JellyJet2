import { useEffect } from 'react';

import { useSession } from '@/auth/session';
import { SignInScreen } from '@/screens/sign-in-screen';
import { AppShell } from '@/shell/app-shell';

export function App() {
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'restoring') return null;
  if (status === 'signedOut') return <SignInScreen />;
  return <AppShell />;
}
