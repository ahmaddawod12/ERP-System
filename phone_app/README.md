# Smart-Job ERP Mobile App

`phone_app/` is the Expo + React Native client for post-login field operations.

## Runtime Role

- Uses Supabase access tokens for backend transport.
- Calls backend gateway endpoints for protected operations.
- Keeps registration and business onboarding on the website.

## Architecture Rules

- Keep route wrappers in `app/`.
- Keep screen logic in `modules/`.
- Prefer shared components in `components/`.
- Use `useAlert()` instead of `Alert.alert()`.
- Use MMKV helpers in `contexts/mmkv-storage.ts`.
- Keep protected writes backend-only.

## Core Structure

```text
app/            Expo Router route wrappers
modules/        Feature screen logic
components/     Shared UI primitives
contexts/       Theme, alert, cache, auth, storage
hooks/          Shared hooks
utils/          Request helpers and utilities
tests/          Mobile tests
theme.ts        Design tokens
firebase.ts     Auth wrappers and gateway helpers
```

## Environment Variables

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL` (optional)

If edge base URL is unset, the app defaults to `${EXPO_PUBLIC_SUPABASE_URL}/functions/v1`.

## Commands

```bash
npm install
npm start
npm run android
npm run ios
npm run web
npm run typecheck
npm run test
```

## Native Requirements

- `google-services.json`
- `GoogleService-Info.plist`

## Build

```bash
eas build --platform android
eas build --platform ios
```

## References

- `../SETUP.md`
- `../backend.md`
- `../architecture.md`
