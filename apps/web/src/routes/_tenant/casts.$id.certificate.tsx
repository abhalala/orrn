import { createFileRoute } from "@tanstack/react-router";

import { CertificateScreen } from "@/features/foundry/certificate-view";

export const Route = createFileRoute("/_tenant/casts/$id/certificate")({
  component: CertificateRoute,
});

function CertificateRoute() {
  const { id } = Route.useParams();
  return <CertificateScreen key={id} id={id} />;
}
