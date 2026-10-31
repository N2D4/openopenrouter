import { HexclaveProvider, HexclaveTheme, UserButton, useUser } from "@hexclave/react";
import { Suspense } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes } from "react-router";
import { hexclaveClientApp } from "./hexclave";
import { RequireAuth, Spinner } from "./lib";
import { Activity } from "./pages/Activity";
import { Authorize } from "./pages/Authorize";
import { Credits } from "./pages/Credits";
import { Docs } from "./pages/Docs";
import { Home } from "./pages/Home";
import { Keys } from "./pages/Keys";
import { ModelDetail } from "./pages/ModelDetail";
import { Models } from "./pages/Models";

function Nav() {
  const user = useUser();
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" />
          {__SITE_NAME__}
        </Link>
        <nav className="nav-links">
          <NavLink to="/models">Models</NavLink>
          <NavLink to="/docs">Docs</NavLink>
          {user && <NavLink to="/activity">Activity</NavLink>}
          {user && <NavLink to="/settings/keys">Keys</NavLink>}
          {user && <NavLink to="/settings/credits">Credits</NavLink>}
        </nav>
        <div className="nav-right">
          {user ? (
            <UserButton />
          ) : (
            <button type="button" className="btn primary" onClick={() => hexclaveClientApp.redirectToSignIn()}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function Layout() {
  return (
    <>
      <Nav />
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} {__SITE_NAME__}</span>
          <a href="https://github.com/N2D4/openopenrouter">Source code</a>
          <Link to="/docs">Docs</Link>
          <Link to="/models">Models</Link>
          <span className="spacer" />
          <span>Not affiliated with OpenRouter, Inc.</span>
        </div>
      </footer>
    </>
  );
}

function SettingsLayout() {
  return (
    <RequireAuth>
      <main className="page settings">
        <nav className="subnav" aria-label="Settings">
          <NavLink to="/settings/keys">API keys</NavLink>
          <NavLink to="/settings/credits">Credits</NavLink>
          <NavLink to="/activity">Activity</NavLink>
        </nav>
        <div>
          <Outlet />
        </div>
      </main>
    </RequireAuth>
  );
}

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <HexclaveProvider app={hexclaveClientApp}>
        <HexclaveTheme>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="models" element={<Models />} />
                <Route path="models/:author/:slug" element={<ModelDetail />} />
                <Route path="docs" element={<Docs />} />
                <Route path="auth" element={<Authorize />} />
                <Route element={<SettingsLayout />}>
                  <Route path="settings/keys" element={<Keys />} />
                  <Route path="settings/credits" element={<Credits />} />
                  <Route path="activity" element={<Activity />} />
                </Route>
                <Route path="keys" element={<Navigate to="/settings/keys" replace />} />
                <Route path="credits" element={<Navigate to="/settings/credits" replace />} />
                {/* OpenRouter-style model URLs, e.g. /anthropic/claude-sonnet-5.5 */}
                <Route path=":author/:slug" element={<ModelDetail />} />
                <Route path="*" element={<main className="page"><h1>Page not found</h1><Link to="/">Go home</Link></main>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </HexclaveTheme>
      </HexclaveProvider>
    </Suspense>
  );
}
