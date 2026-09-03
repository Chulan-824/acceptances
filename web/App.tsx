import { DeliveryPage } from "./DeliveryPage";
import { HomePage } from "./HomePage";
import { RootPage } from "./RootPage";

export function App() {
  if (location.pathname === "/") return <HomePage />;
  if (location.pathname === "/root") return <RootPage />;
  if (["/subject", "/round"].includes(location.pathname)) {
    return <DeliveryPage />;
  }
  return (
    <main className="state">
      <h1>404</h1>
      <p>页面不存在。</p>
      <a href="/">返回本地验收</a>
    </main>
  );
}
