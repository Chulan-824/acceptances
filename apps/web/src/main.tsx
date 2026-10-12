import { TooltipProvider } from "./components/ui/tooltip";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Project as ProjectData } from "@acceptances/api-client";
import { useResource } from "./client";
import { Project } from "./project";
import { Home } from "./home";
import "./style.css";
import "./home.css";
function App() {
  const [path, setPath] = useState(location.pathname);
  const [revision, setRevision] = useState(0);
  const { data, error: loadError } = useResource<{ items: ProjectData[] }>(
    "/projects",
    revision,
  );
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
    <div className="app-shell">
      {project ? (
        <Project
          key={project}
          id={project}
          projects={data?.items}
          projectsError={loadError}
          campaignId={parts[2] === "campaigns" ? parts[3] : undefined}
          runId={parts[4] === "runs" ? parts[5] : undefined}
          navigate={navigate}
          onDeleted={() => {
            setRevision((r) => r + 1);
            navigate("/");
          }}
        />
      ) : (
        <Home
          projects={data?.items}
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
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
