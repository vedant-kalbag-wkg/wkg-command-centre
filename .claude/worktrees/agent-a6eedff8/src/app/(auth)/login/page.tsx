import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <Card
      className="w-full max-w-[400px] border-wk-mid-grey shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
      style={{ borderRadius: "8px", padding: "32px" }}
    >
      <CardHeader className="flex flex-col items-center gap-4 p-0 pb-6">
        {/* Logo placeholder */}
        <div className="flex items-center justify-center w-[120px]">
          <span className="text-2xl font-bold tracking-[-0.01em] text-wk-graphite">
            WK
          </span>
        </div>
        <h1 className="text-xl font-bold tracking-[-0.01em] text-wk-graphite">
          Sign in to WeKnow
        </h1>
      </CardHeader>

      <CardContent className="p-0">
        <LoginForm />
      </CardContent>
    </Card>
  );
}
