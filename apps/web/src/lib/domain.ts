export function getDomainConfig() {
  if (typeof window === "undefined") {
    return {
      isErpDomain: true,
      isMarketingDomain: false,
      marketingUrl: "https://orrn.in",
      erpUrl: "https://erp.orrn.in",
    };
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Local development settings (localhost or 127.0.0.1)
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return {
      isErpDomain: true, // Let localhost act as ERP to view app screens locally
      isMarketingDomain: true,
      marketingUrl: `${protocol}//${window.location.host}`,
      erpUrl: `${protocol}//${window.location.host}`,
    };
  }

  // Deployed staging (dev.orrn.app) or production (orrn.in)
  const isErpDomain = hostname.startsWith("erp.");
  const baseDomain = hostname.replace(/^erp\./, "");

  return {
    isErpDomain,
    isMarketingDomain: !isErpDomain,
    marketingUrl: `${protocol}//${baseDomain}`,
    erpUrl: `${protocol}//erp.${baseDomain}`,
  };
}
