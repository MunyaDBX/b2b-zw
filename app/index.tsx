import { Redirect } from 'expo-router';
import { useSessionStore } from '@/stores/session';

// "/" must pick a destination the root guard allows; redirecting a signed-out
// user to /feed loops, because the guard sends them straight back here.
export default function Entry() {
  const session = useSessionStore((s) => s.session);
  return <Redirect href={session ? '/feed' : '/sign-in'} />;
}
