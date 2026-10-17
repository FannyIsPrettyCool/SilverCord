# Spec: sign-in, registration and first shell

Phase 1. Client side of `docs/spec/auth.md` plus the minimal shell that proves the gateway
connection. BRIEF §6.1, §6.11, §7.

## Screens

| Route (hash) | Screen | Leaves to |
|---|---|---|
| `#/` | Restores the session from the main process; shows nothing but the ambient layer while it does | `#/app` or `#/sign-in` |
| `#/sign-in` | Sign in | `#/sign-in/code` (MFA), `#/app`, `#/register`, `#/forgot-password` |
| `#/sign-in/code` | Second factor (TOTP or recovery code) | `#/app`, back to `#/sign-in` |
| `#/register` | Create account | `#/app`, `#/sign-in` |
| `#/forgot-password` | Request a reset link | `#/sign-in` |
| `#/app` | Shell: rail, empty sidebar and content, user panel with connection state | `#/sign-in` on sign-out or revoked session |

The reset-password and verify-email screens open from deep links, which arrive in phase 7
(`silvercord://` handler); until then those links are completed through the API.

## Layout

- Custom title bar (40 px, draggable) across the top; native window controls are drawn by
  the OS overlay on Windows/Linux, so the right 140 px stay empty.
- Auth screens: one level-3 glass panel, 400 px wide, placed on the left third of the window
  (not centred) so the aurora carries the right side. Wordmark above the panel.
- Shell: 72 px server rail · 240 px sidebar (glass) · content (quiet content layer). User panel
  docked bottom-left of the sidebar.

## Copy (the only strings these screens may show)

| Key | English | French |
|---|---|---|
| `brand` | "SilverCord" | "SilverCord" |
| `signIn.title` | "Sign in" | "Connexion" |
| `signIn.login` | "Email or username" | "E-mail ou nom d'utilisateur" |
| `signIn.password` | "Password" | "Mot de passe" |
| `signIn.submit` | "Sign in" | "Se connecter" |
| `signIn.register` | "Create account" | "Créer un compte" |
| `signIn.forgot` | "Forgot password?" | "Mot de passe oublié ?" |
| `code.title` | "Verification code" | "Code de vérification" |
| `code.code` | "6-digit code" | "Code à 6 chiffres" |
| `code.recovery` | "Recovery code" | "Code de secours" |
| `code.useRecovery` | "Use a recovery code" | "Utiliser un code de secours" |
| `code.useApp` | "Use an authenticator code" | "Utiliser un code d'application" |
| `code.submit` | "Verify" | "Vérifier" |
| `code.back` | "Back" | "Retour" |
| `register.title` | "Create account" | "Créer un compte" |
| `register.email` | "Email" | "E-mail" |
| `register.username` | "Username" | "Nom d'utilisateur" |
| `register.displayName` | "Display name" | "Nom affiché" |
| `register.password` | "Password" | "Mot de passe" |
| `register.invite` | "Invite code" | "Code d'invitation" |
| `register.age` | "I am at least 15 years old" | "J'ai au moins 15 ans" |
| `register.submit` | "Create account" | "Créer le compte" |
| `register.signIn` | "I have an account" | "J'ai déjà un compte" |
| `forgot.title` | "Reset password" | "Réinitialiser le mot de passe" |
| `forgot.email` | "Email" | "E-mail" |
| `forgot.submit` | "Send link" | "Envoyer le lien" |
| `forgot.sent` | "Check your inbox" | "Consultez votre boîte de réception" |
| `forgot.back` | "Back to sign in" | "Retour à la connexion" |
| `session.notRemembered` | "Not remembered on this device" | "Non mémorisé sur cet appareil" |
| `shell.home` | "Home" | "Accueil" |
| `shell.signOut` | "Sign out" | "Se déconnecter" |
| `connection.connected` | "Connected" | "Connecté" |
| `connection.connecting` | "Connecting" | "Connexion…" |
| `connection.offline` | "Offline" | "Hors ligne" |
| `window.minimize` / `maximize` / `close` | "Minimize" / "Maximize" / "Close" | "Réduire" / "Agrandir" / "Fermer" |

Errors (shown under the related field, or under the submit button when not field-specific):

| Code | English | French |
|---|---|---|
| `INVALID_CREDENTIALS` | "Wrong login or password" | "Identifiant ou mot de passe incorrect" |
| `INVALID_TOTP` | "Wrong code" | "Code incorrect" |
| `RATE_LIMITED` | "Too many attempts, try again later" | "Trop de tentatives, réessayez plus tard" |
| `NETWORK` | "Server unreachable" | "Serveur injoignable" |
| `CONFLICT` | "Already taken" | "Déjà utilisé" |
| `INVITE_REQUIRED` | "Valid invite required" | "Invitation valide requise" |
| `REGISTRATION_CLOSED` | "Registration is closed" | "Les inscriptions sont fermées" |
| `TOKEN_INVALID` | "Session expired, sign in again" | "Session expirée, reconnectez-vous" |
| fallback | "Something went wrong" | "Une erreur est survenue" |
| `field.required` | "Required" | "Obligatoire" |
| `field.passwordLength` | "At least 10 characters" | "10 caractères minimum" |
| `field.username` | "2–32 letters, digits, _ or ." | "2 à 32 lettres, chiffres, _ ou ." |
| `field.email` | "Invalid email" | "E-mail invalide" |

## Behaviour

- Client-side validation uses the same Zod schemas as the server (`@silvercord/protocol`);
  the server's answer is authoritative.
- Submit buttons show a spinner and stay the same width; errors announce via `role="alert"`.
- Keyboard: every action reachable with Tab; Enter submits; focus starts in the first field.
- Locale: the app locale (from the OS, `en` fallback) is sent at registration.

## Acceptance criteria

1. Sign up, sign in, sign out, and reload restores the session (when `safeStorage` is available).
2. MFA-enabled accounts are asked for a code; recovery codes work.
3. The shell shows "Connected" once the gateway dispatches READY, "Connecting" while it
   reconnects/resumes, and returns to sign-in when the session is revoked.
4. Every string above exists in EN and FR; no other copy appears (subtraction pass).
5. Screenshots of each screen in Aurora, Frost and Midnight Ember pass `docs/DESIGN-CHECKLIST.md`.
