export function getDomainConfig() {
  if (typeof window === "undefined") {
    return {
      isOrrnAppDomain: false,
      isErpDomain: true,
      isMarketingDomain: false,
      marketingUrl: "https://orrn.in",
      erpUrl: "https://erp.orrn.in",
      staffUrl: "https://orrn.app",
    };
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Local development settings (localhost or 127.0.0.1)
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const searchParams = new URLSearchParams(window.location.search);
    const simulateApp = searchParams.get("__simulate_domain") === "app" || window.localStorage.getItem("__simulate_domain") === "app";

    return {
      isOrrnAppDomain: simulateApp,
      isErpDomain: !simulateApp,
      isMarketingDomain: !simulateApp,
      marketingUrl: `${protocol}//${window.location.host}`,
      erpUrl: `${protocol}//${window.location.host}`,
      staffUrl: `${protocol}//${window.location.host}?__simulate_domain=app`,
    };
  }

  // Check if it's the orrn.app staff domain
  const isOrrnAppDomain = hostname === "orrn.app" || hostname === "dev.orrn.app" || (hostname.endsWith(".orrn.app") && !hostname.startsWith("erp."));
  const isErpDomain = hostname.startsWith("erp.");

  let baseDomain = hostname;
  if (isErpDomain) {
    baseDomain = hostname.replace(/^erp\./, "");
  }

  // Determine marketing (orrn.in) and staff (orrn.app) urls
  const isAppTLD = baseDomain.endsWith("orrn.app");
  const marketingUrl = isAppTLD ? "https://orrn.in" : `${protocol}//${baseDomain}`;
  const erpUrl = isAppTLD ? "https://erp.orrn.in" : `${protocol}//erp.${baseDomain}`;
  const staffUrl = isAppTLD ? `${protocol}//${baseDomain}` : "https://orrn.app";

  return {
    isOrrnAppDomain,
    isErpDomain,
    isMarketingDomain: !isErpDomain && !isOrrnAppDomain,
    marketingUrl,
    erpUrl,
    staffUrl,
  };
}
