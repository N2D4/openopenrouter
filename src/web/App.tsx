import { HexclaveProvider, HexclaveTheme, UserButton, useUser } from "@hexclave/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import { REPO_URL, loadModels, shortName } from "./api";
import { hexclaveClientApp } from "./hexclave";
import { AuthorTile, CloseIcon, Logo, MenuIcon, MonitorIcon, MoonIcon, SearchIcon, SunIcon } from "./icons";
import { RequireAuth, Spinner } from "./lib";
import { Activity } from "./pages/Activity";
import { Authorize } from "./pages/Authorize";
import { Credits } from "./pages/Credits";
import { Docs } from "./pages/Docs";
import { Home } from "./pages/Home";
import { Keys } from "./pages/Keys";
import { ModelDetail } from "./pages/ModelDetail";
import { Models } from "./pages/Models";
import { type ThemePref, setTheme, useThemePref } from "./theme";

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

function NavSearch() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const s = q.trim().toLowerCase();
  const matches = s ? models.filter((m) => m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s)).slice(0, 8) : models.slice(0, 6);

  const go = (path: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    navigate(path);
  };

  return (
    <div className="nav-search">
      <SearchIcon className="nav-search-icon" />
      <input
        ref={input}
        value={q}
        placeholder="Search"
        aria-label="Search models"
        onFocus={() => {
          setOpen(true);
          loadModels().then(setModels, () => {});
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((i) => Math.min(i + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setSel((i) => Math.max(i - 1, 0));
          else if (e.key === "Escape") input.current?.blur();
          else if (e.key === "Enter") go(matches[sel] ? `/models/${matches[sel].id}` : `/models?q=${encodeURIComponent(q)}`);
          else return;
          e.preventDefault();
        }}
      />
      <span className="kbd-group" aria-hidden="true">
        <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
        <kbd>K</kbd>
      </span>
      {open && (
        <div className="nav-search-menu" role="listbox">
          <div className="menu-label">Models</div>
          {matches.length === 0 && <div className="menu-empty">No models match “{q}”</div>}
          {matches.map((m, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === sel}
              key={m.id}
              className={i === sel ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(`/models/${m.id}`)}
            >
              <AuthorTile author={m.id.split("/")[0]} size={22} />
              <span className="menu-name">{shortName(m.name)}</span>
              <span className="menu-id">{m.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLinks({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <NavLink to="/models">Models</NavLink>
      <NavLink to="/docs">Docs</NavLink>
      {signedIn && <NavLink to="/activity">Activity</NavLink>}
      {signedIn && <NavLink to="/settings/keys">Keys</NavLink>}
      {signedIn && <NavLink to="/settings/credits">Credits</NavLink>}
      <a href={REPO_URL}>GitHub</a>
    </>
  );
}

function Nav() {
  const user = useUser();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label={`${__SITE_NAME__} home`}>
          <Logo />
        </Link>
        <NavSearch />
        <nav className="nav-links">
          <NavLinks signedIn={!!user} />
        </nav>
        <div className="nav-right">
          {user ? (
            <UserButton />
          ) : (
            <>
              <button type="button" className="btn nav-signin" onClick={() => hexclaveClientApp.redirectToSignIn()}>
                Sign in
              </button>
              <button type="button" className="btn primary" onClick={() => hexclaveClientApp.redirectToSignUp()}>
                Sign up
              </button>
            </>
          )}
          <button type="button" className="icon-btn nav-menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {menu ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
      </div>
      {menu && (
        <nav className="nav-mobile">
          <NavLinks signedIn={!!user} />
        </nav>
      )}
    </header>
  );
}

function ThemeToggle() {
  const pref = useThemePref();
  const opts: [ThemePref, string, typeof SunIcon][] = [
    ["light", "Light theme", SunIcon],
    ["dark", "Dark theme", MoonIcon],
    ["system", "System theme", MonitorIcon],
  ];
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {opts.map(([v, label, I]) => (
        <button key={v} type="button" role="radio" aria-checked={pref === v} aria-label={label} title={label} className={pref === v ? "active" : ""} onClick={() => setTheme(v)}>
          <I size={14} />
        </button>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link to="/" className="brand" aria-label={`${__SITE_NAME__} home`}>
            <Logo />
          </Link>
          <p>
            © {new Date().getFullYear()} {__SITE_NAME__}
          </p>
          <ThemeToggle />
        </div>
        <div className="footer-col">
          <h3>Product</h3>
          <Link to="/models">Models</Link>
          <Link to="/settings/keys">API Keys</Link>
          <Link to="/settings/credits">Credits</Link>
          <Link to="/activity">Activity</Link>
        </div>
        <div className="footer-col">
          <h3>Developer</h3>
          <Link to="/docs">Documentation</Link>
          <Link to="/docs#endpoints">API Reference</Link>
          <Link to="/docs#claude-code">Claude Code</Link>
          <a href="/api/v1/models">Models API</a>
        </div>
        <div className="footer-col">
          <h3>Open Source</h3>
          <a href={REPO_URL}>GitHub</a>
          <a href={`${REPO_URL}#self-hosting`}>Self-hosting</a>
          <a href={`${REPO_URL}/issues`}>Report an issue</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</a>
        </div>
      </div>
      <div className="footer-bottom">
        <p>
          {__SITE_NAME__} is an independent open-source project with an OpenRouter-compatible API. Not affiliated with OpenRouter, Inc.
        </p>
      </div>
    </footer>
  );
}

/** Scroll to the top on navigation, or to the #hash target when there is one. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const el = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) el.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Layout() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ScrollManager />
      <Nav />
      <div id="main">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </div>
      <Footer />
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

/** Hexclave's components (user menu, sign-in pages) in the site's colors. HSL-parsable values only. */
const hexclaveTheme = {
  radius: "8px",
  light: { primary: "#7624f4", primaryForeground: "#ffffff", ring: "#7624f4", background: "#ffffff", border: "#e6e6e9", input: "#e6e6e9" },
  dark: { primary: "#7c3aed", primaryForeground: "#ffffff", ring: "#9d74f7", background: "#0e0e11", border: "#26262b", input: "#26262b" },
};

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <HexclaveProvider app={hexclaveClientApp}>
        <HexclaveTheme theme={hexclaveTheme}>
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
                <Route
                  path="*"
                  element={
                    <main className="page">
                      <h1>Page not found</h1>
                      <Link to="/">Go home</Link>
                    </main>
                  }
                />
              </Route>
            </Routes>
          </BrowserRouter>
        </HexclaveTheme>
      </HexclaveProvider>
    </Suspense>
  );
}
