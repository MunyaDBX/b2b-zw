import { Redirect } from 'expo-router';

// "/" → feed. If signed out, the root guard sends this on to sign-in.
export default function Entry() {
  return <Redirect href="/feed" />;
}
