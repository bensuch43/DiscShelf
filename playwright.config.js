import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// iPhone 13 viewport, touch and user agent, run in Chromium.
// WebKit is the real iPhone engine: run `npx playwright install webkit` and
// add a project with browserName 'webkit' if you can (see README).
const iphone = { ...devices['iPhone 13'] };
delete iphone.defaultBrowserType;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Screen transitions swallow taps for ~0.2 s, which real people don't notice but
    // fast test clicks do. Tests run as an iPhone with Reduce Motion on (which the app
    // honours); transitions.spec.js covers the animated path on its own.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone-chromium', use: { ...iphone, browserName: 'chromium' } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --directory .`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
