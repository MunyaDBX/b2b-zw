import { Redirect } from 'expo-router';
import { useSessionStore } from '@/stores/session';

// "/" must pick a destination the root guard allows; redirecting a signed-out
// user to /feed loops, because the guard sends them straight back here.
export default function Entry() {
  const signedIn = useSessionStore((s) => !!s.session && !s.recovering);
  return <Redirect href={signedIn ? '/feed' : '/sign-in'} />;
}
