export function themeCss(): string {
  return `
:root {
  --background: #ffffff;
  --foreground: #09090b;
  --card: #ffffff;
  --card-hover: #fafafa;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --border: #e4e4e7;
  --ring: #a1a1aa;
  --accent: #f4f4f5;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --success: #16a34a;
  --warning: #d97706;
  --danger: #dc2626;
  --info: #2563eb;
  --violet: #7c3aed;
  --radius: 8px;
  --shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-lg: 0 10px 30px -12px rgb(0 0 0 / 0.25);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #09090b;
    --foreground: #fafafa;
    --card: #0e0e11;
    --card-hover: #16161a;
    --muted: #18181b;
    --muted-foreground: #a1a1aa;
    --border: #27272a;
    --ring: #52525b;
    --accent: #1f1f23;
    --primary: #fafafa;
    --primary-foreground: #09090b;
    --success: #4ade80;
    --warning: #fbbf24;
    --danger: #f87171;
    --info: #60a5fa;
    --violet: #a78bfa;
    --shadow: 0 1px 2px 0 rgb(0 0 0 / 0.4);
    --shadow-lg: 0 16px 40px -16px rgb(0 0 0 / 0.7);
    color-scheme: dark;
  }
}

* { box-sizing: border-box; }
html, body { height: 100%; }

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}

code, .mono {
  font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, monospace;
  font-size: 12px;
}

h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 15px; }
h2 { font-size: 14px; }
h3 { font-size: 12.5px; }
p { margin: 0; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; border: 3px solid var(--background); }
::-webkit-scrollbar-thumb:hover { background: var(--ring); }

:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
`.trim();
}
