import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Drawer } from "expo-router/drawer";
import { useThemeColor } from "heroui-native";
import React, { useCallback } from "react";
import { Text } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";
import { canAny, useMe } from "@/utils/me";

function DrawerLayout() {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");
  const themeColorMuted = useThemeColor("muted");

  const { data: me } = useMe();
  const hasCompany = !!me?.company;

  const showCustomers = hasCompany;
  const showDies = hasCompany;
  const showReceipts =
    hasCompany && canAny(me, ["receipt.create", "receipt.update", "receipt.delete"]);
  const showBundles = hasCompany;
  const showDispatches = hasCompany;
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
        drawerActiveTintColor: themeColorForeground,
        drawerInactiveTintColor: themeColorMuted,
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          headerTitle: "Home",
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Home</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <Ionicons name="home-outline" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      {/* Legacy tabs demo — hidden from production nav */}
      <Drawer.Screen
        name="(tabs)"
        options={{
          drawerItemStyle: { display: "none" },
          headerShown: false,
        }}
      />
      <Drawer.Screen
        name="customers"
        options={{
          headerShown: false,
          drawerItemStyle: showCustomers ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <>
              {!showCustomers ? null : (
                <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>
                  Customers
                </Text>
              )}
            </>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="people" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      <Drawer.Screen
        name="dies"
        options={{
          headerShown: false,
          drawerItemStyle: showDies ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Dies</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="category" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      <Drawer.Screen
        name="receipts"
        options={{
          headerShown: false,
          drawerItemStyle: showReceipts ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Receipts</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="receipt-long" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      <Drawer.Screen
        name="bundles"
        options={{
          headerShown: false,
          drawerItemStyle: showBundles ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Bundles</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="inventory-2" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      <Drawer.Screen
        name="dispatches"
        options={{
          headerShown: false,
          drawerItemStyle: showDispatches ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Dispatches</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="local-shipping" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      <Drawer.Screen
        name="stock"
        options={{
          headerShown: false,
          drawerItemStyle: showStock ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Stock</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="warehouse" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
      <Drawer.Screen
        name="members"
        options={{
          headerTitle: "Members",
          drawerItemStyle: showMembers ? undefined : { display: "none" },
          drawerLabel: ({ color, focused }) => (
            <Text style={{ color: focused ? color : themeColorForeground, fontSize: 15 }}>Members</Text>
          ),
          drawerIcon: ({ size, color, focused }) => (
            <MaterialIcons name="group" size={size} color={focused ? color : themeColorForeground} />
          ),
        }}
      />
    </Drawer>
  );
}

export default DrawerLayout;
