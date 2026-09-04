import { LoginForm } from "./login-form";

export default function LoginPage() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  return <LoginForm googleClientId={googleClientId} />;
}
