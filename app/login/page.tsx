import { redirect } from 'next/navigation';

/**
 * Sign-in lives in the app shell (`AuthGate`), so this page exists only to
 * keep old links working.
 */
export default function LoginPage() {
  redirect('/');
}
