import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useThemeColor } from "heroui-native";
import React, { useCallback } from "react";
import { Pressable, Text } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";

function DrawerLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  const renderThemeToggle = useCallback(() => <ThemeToggle />, []);

  return (
    <Drawer
      screenOptions={{
        headerTintColor: themeColorForeground,
        headerStyle: { backgroundColor: themeColorBackground },
        headerTitleStyle: {
          fontWeight: "600",
          color: themeColorForeground,
        },
        headerRight: renderThemeToggle,
        drawerStyle: { backgroundColor: themeColorBackground },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          headerTitle: "Home",
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Home</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <Ionicons
              name="home-outline"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="(tabs)"
        options={{
          headerTitle: "Tabs",
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Tabs</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="border-bottom"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable className="mr-4">
                <Ionicons name="add-outline" size={24} color={themeColorForeground} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Drawer.Screen
        name="receipts"
        options={{
          headerShown: false,
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Receipts</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="receipt-long"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="bundles"
        options={{
          headerShown: false,
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Bundles</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="inventory-2"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="dispatches"
        options={{
          headerShown: false,
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Dispatches</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="local-shipping"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
      <Drawer.Screen
        name="stock"
        options={{
          headerShown: false,
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Stock</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="warehouse"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
    </Drawer>
  );
}

export default DrawerLayout;
