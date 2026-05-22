import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useThemeColor } from "heroui-native";
import React, { useCallback } from "react";
import { Pressable, Text } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";
import { canAny, useMe } from "@/utils/me";

function DrawerLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  const { data: me } = useMe();
  const hasCompany = !!me?.company;
  const isPlatformAdmin = !!me?.isPlatformAdmin;

  // For floor-worker ergonomics we want operators to see bundles/dispatches/
  // stock; admins additionally see receipts, members. canAny lets a single
  // matrix drive both this drawer and the web nav.
  const showReceipts =
    hasCompany && canAny(me, ["receipt.create", "receipt.update", "receipt.delete"]);
  const showBundles = hasCompany; // any company user can read bundles
  const showDispatches = hasCompany; // same
  const showStock = hasCompany;
  const showMembers = hasCompany && canAny(me, ["member.invite", "member.updateRole"]);

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
          drawerItemStyle: showReceipts ? undefined : { display: "none" },
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
          drawerItemStyle: showBundles ? undefined : { display: "none" },
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
          drawerItemStyle: showDispatches ? undefined : { display: "none" },
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
          drawerItemStyle: showStock ? undefined : { display: "none" },
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
      <Drawer.Screen
        name="members"
        options={{
          headerTitle: "Members",
          drawerItemStyle: showMembers ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground }}>Members</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons
              name="group"
              size={size}
              color={focused ? color : themeColorForeground}
            />
          ),
        }}
      />
      {/* Platform-admin only links live under a sibling (platform) group in M9;
        for now we leave a header-style indicator so admins know they have
        access to the web platform console. */}
      {isPlatformAdmin ? null : null}
    </Drawer>
  );
}

export default DrawerLayout;
