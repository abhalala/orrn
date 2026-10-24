import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Platform = inferRouterOutputs<AppRouter>["platform"];

export type Overview = Platform["overview"];
export type CompanyListRow = Platform["companiesList"]["items"][number];
export type CompanyDetail = Platform["companiesGet"];
export type GrantRow = CompanyDetail["recentGrants"][number];
export type DeploymentRow = Platform["spoolDeploymentsList"]["items"][number];
export type CreatedDeployment = Platform["spoolDeploymentCreate"];
export type WaitlistRow = Platform["waitlistList"][number];
export type StaffRow = Platform["staffList"][number];
/** The owner's approval email, returned for copying when it could not be sent. */
export type SignInDetails = NonNullable<Platform["waitlistApprove"]["signIn"]>;
export type AwaitingRow = Platform["waitlistAwaitingSignIn"][number];
