import { Button } from "@orrn/ui/components/button";
import { NotFoundPage } from "@orrn/ui/components/not-found";
import { Link, Stack } from "expo-router";

import { Container } from "@/components/container";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Page not found" }} />
      <Container isScrollable={false}>
        <NotFoundPage
          primaryAction={
            <Link href="/" asChild>
              <Button size="lg">Go to ORRN home</Button>
            </Link>
          }
        />
      </Container>
    </>
  );
}
