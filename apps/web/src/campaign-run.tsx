import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createCampaignRunController,
  type CampaignRunScope,
} from "./campaign-run-controller";
import { campaignRunAdapter } from "./campaign-run-adapter";

type Controller = ReturnType<typeof createCampaignRunController>;
const Context = createContext<{
  controller: Controller;
  scope: CampaignRunScope;
} | null>(null);
export function CampaignRunProvider({
  scope,
  children,
}: {
  scope: CampaignRunScope;
  children: ReactNode;
}) {
  const [controller] = useState(() =>
    createCampaignRunController(campaignRunAdapter),
  );
  const { projectId, campaignId, runId } = scope;
  useLayoutEffect(
    () => controller.select({ projectId, campaignId, runId }),
    [controller, projectId, campaignId, runId],
  );
  return (
    <Context.Provider value={{ controller, scope }}>
      {children}
    </Context.Provider>
  );
}
export function useCampaignRun() {
  const value = useContext(Context);
  if (!value) throw new Error("CampaignRunProvider is required");
  const { controller, scope } = value;
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return { view, actions: controller.actions(scope), controller };
}
