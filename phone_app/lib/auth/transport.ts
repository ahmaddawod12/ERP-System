import {
  getAuth,
  onAuthStateChanged as onNativeAuthStateChanged,
  signInWithEmailAndPassword as nativeSignInWithEmailAndPassword,
  signOut as nativeSignOut,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';

export type FirebaseAuthUser = FirebaseAuthTypes.User;

export const auth = getAuth();

export async function signInWithEmailAndPassword(
  authInstance: FirebaseAuthTypes.Module,
  email: string,
  password: string,
) {
  const credential = await nativeSignInWithEmailAndPassword(
    authInstance,
    email,
    password,
  );
  if (!credential.user.emailVerified) {
    await nativeSignOut(authInstance);
    throw new Error('Verify your email before signing in to the mobile app');
  }
  return credential;
}

export function signOut(authInstance: FirebaseAuthTypes.Module): Promise<void> {
  return nativeSignOut(authInstance);
}

export function onAuthStateChanged(
  authInstance: FirebaseAuthTypes.Module,
  listener: (user: FirebaseAuthUser | null) => void,
): () => void {
  return onNativeAuthStateChanged(authInstance, (user) => {
    if (user && !user.emailVerified) {
      listener(null);
      void nativeSignOut(authInstance);
      return;
    }
    listener(user);
  });
}
