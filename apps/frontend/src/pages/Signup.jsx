import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { registerOrganization } from "../lib/apiClient";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";

export default function Signup() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [orgName, setOrgName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setError("");
        try {
            await registerOrganization({
                organization_name: orgName,
                admin_email: email,
                admin_password: password,
            });
            // Account exists now, but we still need a real token — log in
            // right after signing up so the user lands straight in the app.
            await login(email, password);
            navigate("/app/search");
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-paper px-4">
            <Card className="w-full max-w-sm p-8">
                <div className="mb-6 text-center">
                    <h1 className="font-display text-2xl text-ink">Create your organization</h1>
                    <p className="mt-1 text-sm text-slate">
                        This sets you up as the Admin.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <Input
                        id="orgName"
                        label="Organization name"
                        placeholder="Acme Corp"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        required
                    />
                    <Input
                        id="email"
                        label="Your email"
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
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={8}
                        required
                    />
                    {error && <p className="text-xs text-danger">{error}</p>}
                    <Button type="submit" disabled={submitting} className="mt-2">
                        {submitting ? "Creating…" : "Create organization"}
                    </Button>
                </form>

                <p className="mt-5 text-center text-xs text-slate-light">
                    Already have an account?{" "}
                    <Link to="/login" className="text-index hover:underline">
                        Sign in
                    </Link>
                </p>
            </Card>
        </div>
    );
}