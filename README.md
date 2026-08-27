# XV Chat 💜

A mobile-first real-time chat application built with **Firebase + JavaScript** and designed for deployment on **GitHub Pages**.

## Included
- Email signup/login
- Username + unique XV ID
- Real-time 1-to-1 messages
- Reply, copy, reactions, delete-for-everyone UI
- Stickers
- User/chat search
- Typing-state foundation
- Online/offline + last-seen data model
- Seen/delivery states
- Unread counts
- Block/report/privacy/security architecture can be added server-side
- Light, friendly premium UI
- PWA-ready structure

## Setup
1. Create a Firebase project.
2. Enable **Authentication → Email/Password**.
3. Create **Cloud Firestore**.
4. Register a **Web App** in Firebase.
5. Paste its configuration into `firebase-config.js`.
6. Copy `firestore.rules` into Firestore Rules and publish.
7. Upload the project to a GitHub repository and enable GitHub Pages.

## Important production notes
This ZIP is a strong functional starter, not a security-certified messaging system.

- **True End-to-End Encryption (E2EE) is NOT implemented here.** It requires audited client-side cryptography and key management. Do not claim E2EE until it is genuinely implemented.
- **Two-factor authentication** requires Firebase MFA configuration and supported second-factor flows.
- **Push notifications** require Firebase Cloud Messaging configuration plus a service worker and server/Cloud Function to send notifications.
- **Reliable online presence** is better implemented with Firebase Realtime Database presence rather than Firestore alone.
- **Block/report** needs Cloud Functions/admin moderation logic to be secure against client-side bypass.
- Firestore rules should be reviewed before a public launch.

## APK
This project is web/PWA code. To produce a native Android APK, wrap the finished app using **Capacitor** or rebuild the frontend as a native Flutter/Android application. GitHub itself does not compile this into an APK.

## Recommended next build phase
1. Connect Firebase
2. Test two real accounts on two devices
3. Add secure presence + notifications
4. Implement moderation/blocking server-side
5. Add MFA
6. Design and audit E2EE before advertising it
7. Package as Android APK
