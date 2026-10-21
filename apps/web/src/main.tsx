import { TooltipProvider } from "./components/ui/tooltip";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Project as ProjectData } from "@acceptances/api-client";
import { useResource } from "./client";
import { CampaignRunProvider, useCampaignRun } from "./campaign-run";
import { Project } from "./project";
import { Home } from "./home";
import { DeliveryWorkspace } from "./delivery-archive";
import { deletionCovers, deletionReturnPath } from "./deletion";
import "./style.css";
import "./home.css";
import "./delivery.css";
function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(next: string) {
    history.pushState(null, "", next);
    setPath(location.pathname);
  }
  const parts = path.split("/").filter(Boolean);
  const project = parts[0] === "projects" ? parts[1] : undefined;
  return (
    <CampaignRunProvider
      scope={{
        projectId: project,
        campaignId: parts[2] === "campaigns" ? parts[3] : undefined,
        runId: parts[4] === "runs" ? parts[5] : undefined,
      }}
    >
      <Workspace parts={parts} project={project} navigate={navigate} />
    </CampaignRunProvider>
  );
}
function Workspace({
  parts,
  project,
  navigate,
}: {
  parts: string[];
  project?: string;
  navigate: (path: string) => void;
}) {
  const { view } = useCampaignRun();
  const [revision, setRevision] = useState(0);
  const { data, error: loadError } = useResource<{ items: ProjectData[] }>(
    "/projects",
    revision + view.projectsRevision,
  );
  const projects = data?.items.filter(
    (item) => view.deletions[`project:${item.id}`]?.presence !== "missing",
  );
  return (
    <>
      <CampaignRunNavigation navigate={navigate} />
      <div className="app-shell">
        {parts[0] === "deliveries" ? (
          <DeliveryWorkspace parts={parts} navigate={navigate} />
        ) : project ? (
          <Project
            key={project}
            id={project}
            projects={projects}
            projectsError={loadError}
            campaignId={parts[2] === "campaigns" ? parts[3] : undefined}
            navigate={navigate}
          />
        ) : (
          <Home
            projects={projects}
            loadError={loadError}
            onRetry={() => setRevision((r) => r + 1)}
            navigate={navigate}
            onCreated={(item) => {
              setRevision((r) => r + 1);
              navigate(`/projects/${item.id}`);
            }}
          />
        )}
      </div>
    </>
  );
}
function CampaignRunNavigation({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const { view, controller } = useCampaignRun();
  const intent = view.navigationIntent;
  useEffect(() => {
    if (!intent) return;
    const selected = controller.getSnapshot();
    const parts = location.pathname.split("/").filter(Boolean);
    const route = {
      projectId: parts[0] === "projects" ? parts[1] : undefined,
      campaignId: parts[2] === "campaigns" ? parts[3] : undefined,
      runId: parts[4] === "runs" ? parts[5] : selected.selectedRunId,
    };
    if (
      deletionCovers(intent.target, route) &&
      deletionCovers(intent.target, {
        ...selected.scope,
        runId: selected.selectedRunId,
      })
    ) {
      controller.acknowledgeNavigation(intent.token);
      navigate(deletionReturnPath(intent.target));
    }
  }, [intent, controller, navigate]);
  return null;
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
