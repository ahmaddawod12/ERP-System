import {
  getAuth,
  getIdToken,
  onAuthStateChanged,
  reload,
  signInWithEmailAndPassword,
  signOut,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';

export type FirebaseAuthUser = FirebaseAuthTypes.User;

export const firebaseAuth = getAuth();

async function requireVerifiedUser(user: FirebaseAuthUser | null): Promise<FirebaseAuthUser | null> {
  if (!user) return null;
  await reload(user);
  const refreshed = firebaseAuth.currentUser;
  if (!refreshed?.emailVerified) {
    await signOut(firebaseAuth);
    return null;
  }
  return refreshed;
}

export async function restoreFirebaseUser(): Promise<FirebaseAuthUser | null> {
  const current = firebaseAuth.currentUser;
  if (current) return requireVerifiedUser(current);

  return new Promise((resolve, reject) => {
    let settled = false;
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      void requireVerifiedUser(user).then(resolve, reject);
    });
  });
}

export async function signInFirebase(
  email: string,
  password: string,
): Promise<FirebaseAuthUser> {
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  const verified = await requireVerifiedUser(credential.user);
  if (!verified) {
    throw new Error('Verify your email before signing in to the mobile app');
  }
  return verified;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(firebaseAuth);
}

export async function getFirebaseIdToken(
  forceRefresh = true,
): Promise<string | null> {
  const user = await restoreFirebaseUser();
  return user ? getIdToken(user, forceRefresh) : null;
}

export function subscribeFirebaseAuth(
  listener: (user: FirebaseAuthUser | null) => void,
): () => void {
  return onAuthStateChanged(firebaseAuth, (user) => {
    if (user && !user.emailVerified) {
      listener(null);
      void signOut(firebaseAuth);
      return;
    }
    listener(user);
  });
}
