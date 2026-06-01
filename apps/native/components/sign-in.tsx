import { useForm } from "@tanstack/react-form";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { useRef } from "react";
import { ActivityIndicator, Alert, Text, TextInput, View } from "react-native";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/trpc";

const signInSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").min(8, "Use at least 8 characters"),
});

function getErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (Array.isArray(error)) {
    for (const issue of error) {
      const message = getErrorMessage(issue);
      if (message) return message;
    }
    return null;
  }
  if (typeof error === "object" && error !== null) {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") return maybeError.message;
  }
  return null;
}

function SignIn() {
  const passwordInputRef = useRef<TextInput>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value, formApi }) => {
      await authClient.signIn.email(
        { email: value.email.trim(), password: value.password },
        {
          onError(error) {
            Alert.alert("Sign in failed", error.error?.message || "Failed to sign in");
          },
          onSuccess() {
            formApi.reset();
            queryClient.refetchQueries();
          },
        },
      );
    },
  });

  return (
    <View className="rounded-lg border border-border bg-card p-4">
      <Text className="mb-4 font-medium text-foreground">Sign In</Text>

      <form.Subscribe
        selector={(state) => ({
          isSubmitting: state.isSubmitting,
          validationError: getErrorMessage(state.errorMap.onSubmit),
        })}
      >
        {({ isSubmitting, validationError }) => (
          <>
            {validationError ? (
              <Text className="mb-3 text-sm text-destructive">{validationError}</Text>
            ) : null}

            <View className="gap-3">
              <form.Field name="email">
                {(field) => (
                  <View className="gap-1.5">
                    <Label>Email</Label>
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                      placeholder="email@example.com"
                      inputMode="email"
                      autoCapitalize="none"
                      autoComplete="email"
                      onSubmitEditing={() => passwordInputRef.current?.focus()}
                    />
                  </View>
                )}
              </form.Field>

              <form.Field name="password">
                {(field) => (
                  <View className="gap-1.5">
                    <Label>Password</Label>
                    <Input
                      ref={passwordInputRef}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChangeText={field.handleChange}
                      placeholder="••••••••"
                      secureTextEntry
                      autoComplete="password"
                      onSubmitEditing={form.handleSubmit}
                    />
                  </View>
                )}
              </form.Field>

              <Button onPress={form.handleSubmit} disabled={isSubmitting} className="mt-1">
                {isSubmitting ? <ActivityIndicator size="small" /> : "Sign In"}
              </Button>
            </View>
          </>
        )}
      </form.Subscribe>
    </View>
  );
}

export { SignIn };
