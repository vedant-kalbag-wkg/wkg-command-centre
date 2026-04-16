import { Card, CardContent } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <Card
      className="w-full max-w-[400px] border-wk-mid-grey shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
      style={{ borderRadius: "8px", padding: "32px" }}
    >
      <CardContent className="p-0">
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
