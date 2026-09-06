import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    // Mocked latency so the loading state is visible in the demo —
    // replace with a real POST /auth/login call in v0.3.
    setTimeout(() => {
      login(email || "admin@ekip.dev");
      setSubmitting(false);
      navigate("/app/search");
    }, 500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl text-ink">EKIP</h1>
          <p className="mt-1 text-sm text-slate">
            Enterprise Knowledge Intelligence Platform
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="email"
            label="Work email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="password"
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-light">
          Demo build — any email/password signs you in as a mock user.
        </p>
      </Card>
    </div>
  );
}
