import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@orrn/ui/components/button";

import {
  ErpField,
  ErpListCard,
  ErpMutedText,
  ErpScreen,
  ErpSectionTitle,
  ErpTextInput,
} from "@/components/erp";
import { authClient } from "../../lib/auth-client";
import { trpc } from "../../utils/trpc";

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptInviteMutation = useMutation({
    ...trpc.invite.acceptByToken.mutationOptions(),
    onSuccess: () => {
      Alert.alert("Success", "Successfully joined the company!");
      router.replace("/");
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to accept invite");
      setIsSubmitting(false);
    },
  });

  const handleSubmit = async () => {
    if (!email || !name || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (error) {
        if (error.code === "USER_ALREADY_EXISTS") {
          const { error: signInError } = await authClient.signIn.email({
            email,
            password,
          });
          if (signInError) throw new Error(signInError.message || "Failed to sign in");
        } else {
          throw new Error(error.message || "Failed to create account");
        }
      }

      acceptInviteMutation.mutate({ token: token!, name });
    } catch (error: any) {
      Alert.alert("Error", error.message || "An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <ErpScreen className="items-center justify-center p-4">
      <Stack.Screen options={{ title: "Accept Invitation" }} />
      <ErpListCard className="w-full max-w-md gap-4">
        <View className="items-center gap-2">
          <ErpSectionTitle>Join Company</ErpSectionTitle>
          <ErpMutedText className="text-center">
            Set up your account to accept the invitation.
          </ErpMutedText>
        </View>

        <ErpField label="Full Name">
          <ErpTextInput placeholder="Jane Doe" value={name} onChangeText={setName} />
        </ErpField>

        <ErpField label="Email">
          <ErpTextInput
            placeholder="jane@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
        </ErpField>

        <ErpField label="Password">
          <ErpTextInput
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </ErpField>

        <View className="mt-2 min-h-12">
          <Button size="lg" disabled={isSubmitting} onPress={handleSubmit}>
            {isSubmitting ? "Processing..." : "Create Account & Join"}
          </Button>
        </View>
      </ErpListCard>
    </ErpScreen>
  );
}
