import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useState } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { useMutation } from "@tanstack/react-query";

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
    }
  });

  const handleSubmit = async () => {
    if (!email || !name || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Sign up / login via Better Auth
      const { error } = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (error) {
        if (error.code === "USER_ALREADY_EXISTS") {
          // If they already exist, try signing in instead
          const { error: signInError } = await authClient.signIn.email({
             email,
             password,
          });
          if (signInError) throw new Error(signInError.message || "Failed to sign in");
        } else {
          throw new Error(error.message || "Failed to create account");
        }
      }

      // 2. Accept the invite via tRPC
      acceptInviteMutation.mutate({ token: token!, name });

    } catch (error: any) {
      Alert.alert("Error", error.message || "An unexpected error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Accept Invitation" }} />
      <View style={styles.card}>
        <Text style={styles.title}>Join Company</Text>
        <Text style={styles.subtitle}>Set up your account to accept the invitation.</Text>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Jane Doe"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="jane@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity 
            style={[styles.button, isSubmitting && styles.buttonDisabled]} 
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.buttonText}>
              {isSubmitting ? "Processing..." : "Create Account & Join"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    backgroundColor: "white",
    width: "100%",
    maxWidth: 400,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#000",
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
});
