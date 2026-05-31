import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className="relative min-h-screen w-full bg-background flex flex-col overflow-x-hidden">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[15%] top-[-10%] h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-[#5b6cff]/10 to-[#22d3ee]/5 blur-[120px]" />
        <div className="absolute right-[5%] top-[20%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#22d3ee]/8 to-[#3b4edd]/10 blur-[100px]" />
      </div>
      <Outlet />
    </div>
  );
}