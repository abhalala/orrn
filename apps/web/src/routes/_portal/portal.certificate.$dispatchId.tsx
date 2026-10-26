import { createFileRoute } from "@tanstack/react-router";

import { PortalCertificatePage } from "@/features/portal/certificate-page";

export const Route = createFileRoute("/_portal/portal/certificate/$dispatchId")({
  component: CertificateRoute,
});

function CertificateRoute() {
  const { dispatchId } = Route.useParams();
  return <PortalCertificatePage key={dispatchId} dispatchId={dispatchId} />;
}
